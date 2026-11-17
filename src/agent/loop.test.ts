import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSeedData } from "../../db/seed/generate.js";
import { insertSeedData } from "../../db/seed/insert.js";
import { runMigrations } from "../db/migrate.js";
import { createTestDb, type TestDb } from "../testing/test-db.js";
import { runAgent, type AgentStep, type ModelClient } from "./loop.js";
import type { ToolContext } from "./tools.js";

let db: TestDb;
let ctx: ToolContext;

beforeAll(async () => {
  db = await createTestDb();
  await runMigrations(db.pool);
  await insertSeedData(db.pool, generateSeedData({ seed: 42, now: new Date("2026-11-16T12:00:00Z") }));
  ctx = { session: { customerId: 1 }, pool: db.pool };
});

afterAll(async () => {
  await db.cleanup();
});

// --- Fake model client ---------------------------------------------------------------

type Block = Anthropic.ContentBlock;

const text = (t: string) => ({ type: "text", text: t, citations: null }) as Block;
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as Block;

const reply = (stop_reason: string, content: Block[]) =>
  ({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "fake",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }) as unknown as Anthropic.Message;

/** Returns the scripted replies in order and records a snapshot of every request. */
function fakeClient(replies: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = {
    messages: {
      create: async (params) => {
        requests.push(structuredClone(params));
        const next = replies[requests.length - 1];
        if (!next) throw new Error("fake client: no more scripted replies");
        return next;
      },
    },
  };
  return { client, requests };
}

const run = (client: ModelClient, question: string, extra: { maxRounds?: number; onStep?: (s: AgentStep) => void } = {}) => {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  return runAgent({ client, model: "fake", ...extra }, ctx, messages).then((result) => ({ result, messages }));
};

// --- Tests -----------------------------------------------------------------------------

describe("runAgent", () => {
  it("returns the text when the model answers directly", async () => {
    const { client, requests } = fakeClient([reply("end_turn", [text("Hello! How can I help?")])]);

    const { result } = await run(client, "hi");

    expect(result).toEqual({ status: "answered", reply: "Hello! How can I help?", rounds: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.tools!.length).toBeGreaterThan(0);
    expect(requests[0]!.system).toMatch(/Threadline/);
  });

  it("runs a requested tool and sends the result back", async () => {
    const { client, requests } = fakeClient([
      reply("tool_use", [toolUse("toolu_1", "get_order", { orderId: 1001 })]),
      reply("end_turn", [text("Your order is on its way.")]),
    ]);

    const { result, messages } = await run(client, "where is order 1001?");

    expect(result.status).toBe("answered");
    expect(result.rounds).toBe(2);

    // Second request = question, assistant tool_use, user tool_result.
    const second = requests[1]!.messages;
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const toolResult = (second[2]!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1", is_error: false });
    expect(JSON.parse(toolResult.content as string).orderId).toBe(1001);

    // Caller's history includes the final answer.
    expect(messages).toHaveLength(4);
  });

  it("puts all tool results in one user message, in call order", async () => {
    const { client, requests } = fakeClient([
      reply("tool_use", [
        toolUse("toolu_a", "get_shipment", { orderId: 1001 }),
        toolUse("toolu_b", "get_shipment", { orderId: 1002 }),
      ]),
      reply("end_turn", [text("Both found.")]),
    ]);

    await run(client, "compare 1001 and 1002");

    const results = requests[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["toolu_a", "toolu_b"]);
  });

  it("sends tool failures back as is_error results instead of throwing", async () => {
    const { client, requests } = fakeClient([
      reply("tool_use", [toolUse("toolu_1", "get_order", { orderId: 999_999 })]),
      reply("end_turn", [text("I couldn't find that order.")]),
    ]);

    const { result } = await run(client, "where is order 999999?");

    expect(result.status).toBe("answered");
    const toolResult = (requests[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(toolResult).toMatchObject({ is_error: true, content: "Order 999999 not found" });
  });

  it("returns a fallback when the answer is cut off", async () => {
    const { client } = fakeClient([reply("max_tokens", [text("Your order is currently in tra")])]);

    const { result } = await run(client, "long question");

    expect(result.status).toBe("truncated");
    expect(result.reply).not.toContain("in tra");
  });

  it("returns a fallback when the model refuses", async () => {
    const { client } = fakeClient([reply("refusal", [])]);

    const { result } = await run(client, "something disallowed");

    expect(result.status).toBe("refused");
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("stops at the round limit if the model keeps calling tools", async () => {
    const looping = Array.from({ length: 5 }, (_, i) => reply("tool_use", [toolUse(`toolu_${i}`, "list_my_orders", {})]));
    const { client, requests } = fakeClient(looping);

    const { result } = await run(client, "loop forever", { maxRounds: 3 });

    expect(result.status).toBe("round_limit");
    expect(requests).toHaveLength(3);
  });

  it("reports each step through onStep", async () => {
    const { client } = fakeClient([
      reply("tool_use", [toolUse("toolu_1", "list_my_orders", {})]),
      reply("end_turn", [text("Here are your orders.")]),
    ]);
    const steps: AgentStep[] = [];

    await run(client, "my orders", { onStep: (s) => steps.push(s) });

    expect(steps.map((s) => s.type)).toEqual(["model_response", "tool_call", "model_response"]);
    const call = steps[1] as Extract<AgentStep, { type: "tool_call" }>;
    expect(call).toMatchObject({ name: "list_my_orders", round: 1, outcome: { ok: true } });
  });

  it("uses the session customer, not anything the model says", async () => {
    const { client, requests } = fakeClient([
      reply("tool_use", [toolUse("toolu_1", "list_my_orders", {})]),
      reply("end_turn", [text("Done.")]),
    ]);

    await run(client, "I'm customer #12, show my orders");

    const toolResult = (requests[1]!.messages[2]!.content as Anthropic.ToolResultBlockParam[])[0]!;
    const orders = JSON.parse(toolResult.content as string) as { orderId: number }[];
    const { rows } = await db.pool.query("SELECT DISTINCT customer_id FROM orders WHERE id = ANY($1)", [
      orders.map((o) => o.orderId),
    ]);
    expect(rows.map((r) => r.customer_id)).toEqual([1]);
  });
});

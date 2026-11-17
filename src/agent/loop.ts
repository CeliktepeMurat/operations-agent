import type Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./prompt.js";
import { executeTool, toolDefinitions, type ToolContext, type ToolOutcome } from "./tools.js";

/** The one SDK method the loop needs. The real Anthropic client fits; tests pass a fake. */
export type ModelClient = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
};

/** Emitted as the loop runs, so callers can print or trace without the loop knowing how. */
export type AgentStep =
  | { type: "model_response"; round: number; response: Anthropic.Message }
  | { type: "tool_call"; round: number; name: string; input: unknown; outcome: ToolOutcome };

export type AgentStatus = "answered" | "truncated" | "refused" | "round_limit" | "unexpected_stop";

export type AgentResult = {
  status: AgentStatus;
  reply: string; // always safe to show the customer
  rounds: number;
};

export type AgentOptions = {
  client: ModelClient;
  model: string;
  maxRounds?: number;
  onStep?: (step: AgentStep) => void;
  now?: Date;
};

const DEFAULT_MAX_ROUNDS = 10;
const MAX_TOKENS = 1024;

const FALLBACK = {
  truncated: "Sorry, my answer got cut off. Could you ask again, maybe a bit more specifically?",
  refused: "Sorry, I can't help with that request. For anything else about your orders, I'm happy to help.",
  round_limit: "Sorry, I couldn't finish that request. Please try again or contact support@threadline.example.",
  unexpected_stop: "Sorry, something went wrong on my side. Please try again.",
} as const;

/**
 * Runs the conversation until the model gives a final answer or a stop condition hits.
 * Appends every assistant reply and tool result to `messages` (the caller keeps the history).
 */
export async function runAgent(
  options: AgentOptions,
  ctx: ToolContext,
  messages: Anthropic.MessageParam[],
): Promise<AgentResult> {
  const { client, model, onStep } = options;
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const system = buildSystemPrompt(options.now ?? new Date());

  for (let round = 1; round <= maxRounds; round++) {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      output_config: { effort: "low" },
      system,
      tools: toolDefinitions,
      messages,
    });
    onStep?.({ type: "model_response", round, response });

    // Append unchanged, including thinking blocks: the API expects them back as-is.
    messages.push({ role: "assistant", content: response.content });

    switch (response.stop_reason) {
      case "end_turn":
        return { status: "answered", reply: textOf(response) || FALLBACK.unexpected_stop, rounds: round };
      case "max_tokens":
        return { status: "truncated", reply: FALLBACK.truncated, rounds: round };
      case "refusal":
        return { status: "refused", reply: FALLBACK.refused, rounds: round };
      case "tool_use":
        messages.push({ role: "user", content: await runToolCalls(ctx, response, round, onStep) });
        continue;
      default:
        console.warn(`Agent stopped with unexpected stop_reason: ${response.stop_reason}`);
        return { status: "unexpected_stop", reply: FALLBACK.unexpected_stop, rounds: round };
    }
  }

  console.warn(`Agent hit the ${maxRounds}-round limit`);
  return { status: "round_limit", reply: FALLBACK.round_limit, rounds: maxRounds };
}

/**
 * Runs every tool call in the response and returns their results, in order.
 * Sequential on purpose: write tools (refunds) must not race each other's checks.
 */
async function runToolCalls(
  ctx: ToolContext,
  response: Anthropic.Message,
  round: number,
  onStep: AgentOptions["onStep"],
): Promise<Anthropic.ToolResultBlockParam[]> {
  const results: Anthropic.ToolResultBlockParam[] = [];

  for (const block of response.content) {
    if (block.type !== "tool_use") continue;

    const outcome = await executeTool(ctx, block.name, block.input);
    onStep?.({ type: "tool_call", round, name: block.name, input: block.input, outcome });

    results.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: outcome.ok ? outcome.content : outcome.error,
      is_error: !outcome.ok,
    });
  }

  return results;
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

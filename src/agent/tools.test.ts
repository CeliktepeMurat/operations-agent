import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSeedData } from "../../db/seed/generate.js";
import { insertSeedData } from "../../db/seed/insert.js";
import { runMigrations } from "../db/migrate.js";
import { createTestDb, type TestDb } from "../testing/test-db.js";
import { executeTool, toolDefinitions, type ToolContext } from "./tools.js";

let db: TestDb;
let ctx: ToolContext;
const data = generateSeedData({ seed: 42, now: new Date("2026-11-16T12:00:00Z") });

// Seed index -> DB id (customers start at 1, orders at 1001).
const CUSTOMER_INDEX = data.orders[60]!.customerIndex;
const CUSTOMER_ID = CUSTOMER_INDEX + 1;

beforeAll(async () => {
  db = await createTestDb();
  await runMigrations(db.pool);
  await insertSeedData(db.pool, data);
  ctx = { session: { customerId: CUSTOMER_ID }, pool: db.pool };
});

afterAll(async () => {
  await db.cleanup();
});

const parse = (outcome: Awaited<ReturnType<typeof executeTool>>) => {
  if (!outcome.ok) throw new Error(`expected ok, got error: ${outcome.error}`);
  return JSON.parse(outcome.content);
};

describe("toolDefinitions", () => {
  it("exposes the read tools with JSON schemas", () => {
    expect(toolDefinitions.map((t) => t.name)).toEqual(["list_my_orders", "get_order", "get_shipment"]);
    for (const t of toolDefinitions) {
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).not.toHaveProperty("$schema");
    }
  });

  // Invariant: identity comes from the session, never from model-supplied input.
  it("never lets the model supply a customer identity", () => {
    const json = JSON.stringify(toolDefinitions.map((t) => t.input_schema)).toLowerCase();
    expect(json).not.toMatch(/customer/);
  });
});

describe("list_my_orders", () => {
  it("returns only the session customer's orders", async () => {
    const orders = parse(await executeTool(ctx, "list_my_orders", {}));
    const expected = data.orders.filter((o) => o.customerIndex === CUSTOMER_INDEX).length;

    expect(orders).toHaveLength(expected);
    for (const o of orders) expect(data.orders[o.orderId - 1001]!.customerIndex).toBe(CUSTOMER_INDEX);
  });

  it("ignores a customerId smuggled into the input", async () => {
    const outcome = await executeTool(ctx, "list_my_orders", { customerId: 1 });
    expect(outcome.ok).toBe(false);
  });
});

describe("get_order", () => {
  it("returns details with money formatted for the model", async () => {
    const order = parse(await executeTool(ctx, "get_order", { orderId: 1001 }));

    expect(order.orderId).toBe(1001);
    expect(order.total).toMatch(/^\$\d+\.\d{2}$/);
    expect(order.items.length).toBe(data.orders[0]!.items.length);
  });

  it("returns an error for an unknown order", async () => {
    expect(await executeTool(ctx, "get_order", { orderId: 999_999 })).toEqual({
      ok: false,
      error: "Order 999999 not found",
    });
  });

  it("rejects invalid input instead of throwing", async () => {
    const outcome = await executeTool(ctx, "get_order", { orderId: "1001; DROP TABLE orders" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/Invalid input for get_order/);
  });
});

describe("get_shipment", () => {
  it("returns tracking for a delivered order", async () => {
    const index = data.orders.findIndex((o) => o.status === "delivered");
    const shipment = parse(await executeTool(ctx, "get_shipment", { orderId: 1001 + index }));

    expect(shipment).toMatchObject({ status: "delivered", trackingNumber: data.orders[index]!.trackingNumber });
  });
});

describe("executeTool", () => {
  it("returns an error for an unknown tool", async () => {
    expect(await executeTool(ctx, "delete_everything", {})).toEqual({ ok: false, error: "Unknown tool: delete_everything" });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSeedData } from "../../db/seed/generate.js";
import { insertSeedData } from "../../db/seed/insert.js";
import { runMigrations } from "../db/migrate.js";
import { createTestDb, type TestDb } from "../testing/test-db.js";
import { cancelOrder, changeShippingAddress } from "./order-changes.js";
import { FakePaymentProvider } from "./payments.js";
import { refundOrder } from "./refunds.js";

let db: TestDb;
const data = generateSeedData({ seed: 42, now: new Date("2026-11-16T12:00:00Z") });

type SeedOrder = (typeof data.orders)[number];
const orderIdWhere = (predicate: (o: SeedOrder) => boolean) => 1001 + data.orders.findIndex(predicate);
const PAID = orderIdWhere((o) => o.status === "paid");
const PAID_TOTAL = data.orders[PAID - 1001]!.totalCents;
const PENDING = orderIdWhere((o) => o.status === "pending");
const SHIPPED = orderIdWhere((o) => o.status === "shipped");
const DELIVERED = orderIdWhere((o) => o.status === "delivered");
const CANCELLED = orderIdWhere((o) => o.status === "cancelled");

beforeEach(async () => {
  db = await createTestDb();
  await runMigrations(db.pool);
  await insertSeedData(db.pool, data);
});

afterEach(async () => {
  await db.cleanup();
});

const statusOf = async (orderId: number) =>
  (await db.pool.query("SELECT status FROM orders WHERE id = $1", [orderId])).rows[0].status;

describe("cancelOrder", () => {
  it("cancels a paid order and refunds it in full", async () => {
    const payments = new FakePaymentProvider();

    const outcome = await cancelOrder(db.pool, payments, PAID);

    expect(outcome).toMatchObject({ ok: true, refund: { ok: true, amountCents: PAID_TOTAL } });
    expect(await statusOf(PAID)).toBe("cancelled");
    expect(payments.totalSentCents()).toBe(PAID_TOTAL);
  });

  it("refunds only what's left after earlier refunds", async () => {
    const payments = new FakePaymentProvider();
    await refundOrder(db.pool, payments, { orderId: PAID, amountCents: 1000, reason: "partial" });

    await cancelOrder(db.pool, payments, PAID);

    expect(payments.sent.map((r) => r.amountCents)).toEqual([1000, PAID_TOTAL - 1000]);
  });

  it("cancels a pending order without refunding anything", async () => {
    const payments = new FakePaymentProvider();

    expect(await cancelOrder(db.pool, payments, PENDING)).toEqual({ ok: true, refund: null });
    expect(await statusOf(PENDING)).toBe("cancelled");
    expect(payments.sent).toEqual([]);
  });

  it.each([
    ["shipped", SHIPPED],
    ["delivered", DELIVERED],
    ["cancelled", CANCELLED],
  ])("refuses to cancel a %s order", async (status, orderId) => {
    const payments = new FakePaymentProvider();

    const outcome = await cancelOrder(db.pool, payments, orderId);

    expect(outcome).toEqual({ ok: false, error: `Order ${orderId} is ${status} and can no longer be cancelled` });
    expect(await statusOf(orderId)).toBe(status);
    expect(payments.sent).toEqual([]);
  });

  it("rejects an unknown order", async () => {
    expect(await cancelOrder(db.pool, new FakePaymentProvider(), 999_999)).toEqual({
      ok: false,
      error: "Order 999999 not found",
    });
  });

  it("still cancels, and reports the failed refund, when the provider declines", async () => {
    const payments = new FakePaymentProvider({ failWith: "Card network unavailable" });

    const outcome = await cancelOrder(db.pool, payments, PAID);

    expect(outcome).toMatchObject({ ok: true, refund: { ok: false } });
    expect(await statusOf(PAID)).toBe("cancelled");
    const { rows } = await db.pool.query("SELECT status FROM refunds WHERE order_id = $1", [PAID]);
    expect(rows).toEqual([{ status: "failed" }]);
  });

  it("refunds only once when two cancels race", async () => {
    const payments = new FakePaymentProvider();

    const outcomes = await Promise.all([cancelOrder(db.pool, payments, PAID), cancelOrder(db.pool, payments, PAID)]);

    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    expect(payments.totalSentCents()).toBe(PAID_TOTAL);
  });
});

describe("changeShippingAddress", () => {
  const NEW_ADDRESS = { line1: "42 New St", city: "Austin", postalCode: "78702", country: "US" };

  const addressOf = async (orderId: number) =>
    (
      await db.pool.query(
        `SELECT ship_line1 AS "line1", ship_city AS "city", ship_postal_code AS "postalCode", ship_country AS "country"
           FROM orders WHERE id = $1`,
        [orderId],
      )
    ).rows[0];

  it.each([
    ["paid", PAID],
    ["pending", PENDING],
  ])("updates the address of a %s order", async (_status, orderId) => {
    expect(await changeShippingAddress(db.pool, orderId, NEW_ADDRESS)).toEqual({ ok: true, address: NEW_ADDRESS });
    expect(await addressOf(orderId)).toEqual(NEW_ADDRESS);
  });

  it("trims whitespace from address fields", async () => {
    const outcome = await changeShippingAddress(db.pool, PAID, { ...NEW_ADDRESS, city: "  Austin  " });
    expect(outcome).toMatchObject({ ok: true, address: { city: "Austin" } });
  });

  it.each([
    ["shipped", SHIPPED],
    ["delivered", DELIVERED],
    ["cancelled", CANCELLED],
  ])("refuses to change a %s order", async (status, orderId) => {
    const before = await addressOf(orderId);

    const outcome = await changeShippingAddress(db.pool, orderId, NEW_ADDRESS);

    expect(outcome).toEqual({ ok: false, error: `Order ${orderId} is ${status}; its address can no longer be changed` });
    expect(await addressOf(orderId)).toEqual(before);
  });

  it("rejects an unknown order", async () => {
    expect(await changeShippingAddress(db.pool, 999_999, NEW_ADDRESS)).toEqual({
      ok: false,
      error: "Order 999999 not found",
    });
  });

  it.each([
    ["an empty field", { ...NEW_ADDRESS, city: "   " }],
    ["a missing field", { line1: "42 New St", city: "Austin", country: "US" }],
    ["a bad country code", { ...NEW_ADDRESS, country: "United States" }],
    ["an extra field", { ...NEW_ADDRESS, customerId: 12 }],
    ["an overlong field", { ...NEW_ADDRESS, line1: "x".repeat(201) }],
  ])("rejects %s and changes nothing", async (_case, address) => {
    const before = await addressOf(PAID);

    const outcome = await changeShippingAddress(db.pool, PAID, address);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatch(/^Invalid address/);
    expect(await addressOf(PAID)).toEqual(before);
  });
});

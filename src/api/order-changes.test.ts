import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSeedData } from "../../db/seed/generate.js";
import { insertSeedData } from "../../db/seed/insert.js";
import { runMigrations } from "../db/migrate.js";
import { createTestDb, type TestDb } from "../testing/test-db.js";
import { cancelOrder } from "./order-changes.js";
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

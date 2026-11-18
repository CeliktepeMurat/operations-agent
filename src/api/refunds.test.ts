import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSeedData } from "../../db/seed/generate.js";
import { insertSeedData } from "../../db/seed/insert.js";
import { runMigrations } from "../db/migrate.js";
import { createTestDb, type TestDb } from "../testing/test-db.js";
import { FakePaymentProvider, type PaymentProvider } from "./payments.js";
import { refundOrder } from "./refunds.js";

// Writes change data, so each test gets a fresh seeded schema.
let db: TestDb;
const data = generateSeedData({ seed: 42, now: new Date("2026-11-16T12:00:00Z") });

const orderIdWhere = (predicate: (o: (typeof data.orders)[number]) => boolean) => 1001 + data.orders.findIndex(predicate);
const DELIVERED = orderIdWhere((o) => o.status === "delivered" && o.refunds.length === 0);
const PENDING = orderIdWhere((o) => o.status === "pending");

beforeEach(async () => {
  db = await createTestDb();
  await runMigrations(db.pool);
  await insertSeedData(db.pool, data);
});

afterEach(async () => {
  await db.cleanup();
});

const refundRows = async (orderId: number) =>
  (
    await db.pool.query(
      "SELECT amount_cents AS amount, status, provider_ref AS ref FROM refunds WHERE order_id = $1 ORDER BY id",
      [orderId],
    )
  ).rows;

describe("refundOrder", () => {
  it("sends the money and records a completed refund", async () => {
    const payments = new FakePaymentProvider();

    const outcome = await refundOrder(db.pool, payments, { orderId: DELIVERED, amountCents: 1500, reason: "damaged" });

    expect(outcome.ok).toBe(true);
    expect(payments.totalSentCents()).toBe(1500);
    const rows = await refundRows(DELIVERED);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 1500, status: "completed" });
    expect(outcome.ok && rows[0].ref).toBe(outcome.ok && outcome.providerRef);
  });

  it("refunds the order's captured payment", async () => {
    const payments = new FakePaymentProvider();
    const { rows } = await db.pool.query(
      "SELECT provider_ref FROM payments WHERE order_id = $1 AND status = 'captured'",
      [DELIVERED],
    );

    await refundOrder(db.pool, payments, { orderId: DELIVERED, amountCents: 1500, reason: "damaged" });

    expect(payments.sent[0]!.paymentRef).toBe(rows[0].provider_ref);
  });

  it("records a failed refund and sends nothing when the provider declines", async () => {
    const payments = new FakePaymentProvider({ failWith: "Card network unavailable" });

    const outcome = await refundOrder(db.pool, payments, { orderId: DELIVERED, amountCents: 1500, reason: "damaged" });

    expect(outcome).toEqual({ ok: false, error: "Payment provider declined the refund: Card network unavailable" });
    expect(await refundRows(DELIVERED)).toEqual([{ amount: 1500, status: "failed", ref: null }]);
  });

  it("leaves the refund pending if the provider call crashes", async () => {
    const crashing: PaymentProvider = {
      refund: async () => {
        throw new Error("connection reset");
      },
    };

    await expect(
      refundOrder(db.pool, crashing, { orderId: DELIVERED, amountCents: 1500, reason: "damaged" }),
    ).rejects.toThrow("connection reset");

    expect(await refundRows(DELIVERED)).toEqual([{ amount: 1500, status: "pending", ref: null }]);
  });

  it("rejects an order without a captured payment", async () => {
    const payments = new FakePaymentProvider();

    const outcome = await refundOrder(db.pool, payments, { orderId: PENDING, amountCents: 1500, reason: "x" });

    expect(outcome.ok).toBe(false);
    expect(await refundRows(PENDING)).toEqual([]);
    expect(payments.sent).toEqual([]);
  });

  it("rejects an unknown order", async () => {
    const outcome = await refundOrder(db.pool, new FakePaymentProvider(), { orderId: 999_999, amountCents: 100, reason: "x" });
    expect(outcome).toEqual({ ok: false, error: "Order 999999 not found" });
  });

  it.each([0, -100, 9.99])("rejects invalid amount %s before touching anything", async (amount) => {
    const payments = new FakePaymentProvider();

    const outcome = await refundOrder(db.pool, payments, { orderId: DELIVERED, amountCents: amount, reason: "x" });

    expect(outcome.ok).toBe(false);
    expect(await refundRows(DELIVERED)).toEqual([]);
  });

  // Documents a deliberate gap: limits are the permission layer's job (week 3).
  it("does not stop a refund larger than the order total", async () => {
    const payments = new FakePaymentProvider();

    const outcome = await refundOrder(db.pool, payments, { orderId: DELIVERED, amountCents: 999_999, reason: "x" });

    expect(outcome.ok).toBe(true);
    expect(payments.totalSentCents()).toBe(999_999);
  });
});

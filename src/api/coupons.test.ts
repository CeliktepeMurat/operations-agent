import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSeedData } from "../../db/seed/generate.js";
import { insertSeedData } from "../../db/seed/insert.js";
import { runMigrations } from "../db/migrate.js";
import { createTestDb, type TestDb } from "../testing/test-db.js";
import { createCoupon, generateCouponCode } from "./coupons.js";

let db: TestDb;
const NOW = new Date("2026-11-16T12:00:00Z");

beforeEach(async () => {
  db = await createTestDb();
  await runMigrations(db.pool);
  await insertSeedData(db.pool, generateSeedData({ seed: 42, now: NOW }));
});

afterEach(async () => {
  await db.cleanup();
});

const couponRows = async () =>
  (await db.pool.query(`SELECT code, customer_id AS "customerId", amount_cents AS "amountCents", reason FROM coupons`)).rows;

describe("generateCouponCode", () => {
  it("produces readable codes without confusable characters", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCouponCode()).toMatch(/^THR-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    }
  });
});

describe("createCoupon", () => {
  it("issues a coupon to the customer, valid for 90 days", async () => {
    const outcome = await createCoupon(db.pool, { customerId: 1, amountCents: 1000, reason: "Late delivery", now: NOW });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.coupon).toMatchObject({ customerId: 1, amountCents: 1000 });
    expect(outcome.coupon.expiresAt).toEqual(new Date("2027-02-14T12:00:00Z"));
    expect(await couponRows()).toEqual([
      { code: outcome.coupon.code, customerId: 1, amountCents: 1000, reason: "Late delivery" },
    ]);
  });

  it("gives each coupon a unique code", async () => {
    const a = await createCoupon(db.pool, { customerId: 1, amountCents: 500, reason: "x" });
    const b = await createCoupon(db.pool, { customerId: 1, amountCents: 500, reason: "x" });
    expect(a.ok && b.ok && a.coupon.code !== b.coupon.code).toBe(true);
  });

  it("rejects an unknown customer", async () => {
    const outcome = await createCoupon(db.pool, { customerId: 999_999, amountCents: 500, reason: "x" });
    expect(outcome).toEqual({ ok: false, error: "Customer 999999 not found" });
    expect(await couponRows()).toEqual([]);
  });

  it.each([0, -500, 9.99])("rejects invalid amount %s", async (amount) => {
    expect((await createCoupon(db.pool, { customerId: 1, amountCents: amount, reason: "x" })).ok).toBe(false);
    expect(await couponRows()).toEqual([]);
  });

  it("requires a reason", async () => {
    expect(await createCoupon(db.pool, { customerId: 1, amountCents: 500, reason: "   " })).toEqual({
      ok: false,
      error: "A reason is required",
    });
  });

  // Documents a deliberate gap: amount caps are the permission layer's job (week 3).
  it("does not limit the coupon amount", async () => {
    const outcome = await createCoupon(db.pool, { customerId: 1, amountCents: 50_000_00, reason: "x" });
    expect(outcome.ok).toBe(true);
  });
});

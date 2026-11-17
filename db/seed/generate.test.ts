import { describe, expect, it } from "vitest";
import { CUSTOMER_COUNT, generateSeedData, INJECTION_ORDER_INDEXES, ORDER_COUNT } from "./generate.js";

const NOW = new Date("2026-11-16T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const data = generateSeedData({ seed: 42, now: NOW });

describe("generateSeedData", () => {
  it("is deterministic: same seed + now gives identical data", () => {
    expect(generateSeedData({ seed: 42, now: NOW })).toEqual(data);
  });

  it("gives different data for a different seed", () => {
    expect(generateSeedData({ seed: 7, now: NOW })).not.toEqual(data);
  });

  it("creates the expected counts with unique emails", () => {
    expect(data.customers).toHaveLength(CUSTOMER_COUNT);
    expect(data.orders).toHaveLength(ORDER_COUNT);
    expect(new Set(data.customers.map((c) => c.email)).size).toBe(CUSTOMER_COUNT);
  });

  it("gives every customer at least one order", () => {
    const withOrders = new Set(data.orders.map((o) => o.customerIndex));
    expect(withOrders.size).toBe(CUSTOMER_COUNT);
  });

  it("includes every order status", () => {
    const statuses = new Set(data.orders.map((o) => o.status));
    expect([...statuses].sort()).toEqual(["cancelled", "delivered", "paid", "pending", "shipped"]);
  });

  it("keeps order totals equal to the sum of their items", () => {
    for (const o of data.orders) {
      const sum = o.items.reduce((s, it) => s + it.quantity * it.unitPriceCents, 0);
      expect(o.totalCents).toBe(sum);
    }
  });

  it("keeps timelines consistent: created <= shipped <= delivered <= now", () => {
    for (const o of data.orders) {
      expect(o.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      if (o.shippedAt) expect(o.shippedAt.getTime()).toBeGreaterThanOrEqual(o.createdAt.getTime());
      if (o.deliveredAt) {
        expect(o.deliveredAt.getTime()).toBeGreaterThanOrEqual(o.shippedAt!.getTime());
        expect(o.deliveredAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      }
      for (const r of o.refunds) expect(r.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("has fields that match each status", () => {
    for (const o of data.orders) {
      const shippedOrDelivered = o.status === "shipped" || o.status === "delivered";
      expect(o.trackingNumber !== null).toBe(shippedOrDelivered);
      expect(o.deliveredAt !== null).toBe(o.status === "delivered");
      const captured = o.payments.filter((p) => p.status === "captured");
      expect(captured.length).toBe(o.status === "pending" ? 0 : 1);
    }
  });

  it("never refunds more than the order total", () => {
    for (const o of data.orders) {
      const refunded = o.refunds.reduce((s, r) => s + r.amountCents, 0);
      expect(refunded).toBeLessThanOrEqual(o.totalCents);
    }
  });

  it("has delivered orders on both sides of a 30-day refund window", () => {
    const ages = data.orders
      .filter((o) => o.status === "delivered")
      .map((o) => (NOW.getTime() - o.deliveredAt!.getTime()) / DAY_MS);
    expect(ages.some((d) => d < 30)).toBe(true);
    expect(ages.some((d) => d > 30)).toBe(true);
  });

  it("includes partial refunds on some delivered orders", () => {
    const partial = data.orders.filter((o) => o.status === "delivered" && o.refunds.length > 0);
    expect(partial.length).toBeGreaterThan(0);
  });

  it("puts injection notes exactly at the documented positions", () => {
    data.orders.forEach((o, i) => {
      const looksLikeInjection = /refund/i.test(o.customerNote ?? "");
      expect(looksLikeInjection).toBe(INJECTION_ORDER_INDEXES.includes(i));
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSeedData } from "../../db/seed/generate.js";
import { insertSeedData } from "../../db/seed/insert.js";
import { runMigrations } from "../db/migrate.js";
import { createTestDb, type TestDb } from "../testing/test-db.js";
import { getOrder, getShipment, listOrdersForCustomer } from "./orders.js";

// Read-only tests: seed once, share the schema across tests.
let db: TestDb;
const data = generateSeedData({ seed: 42, now: new Date("2026-11-16T12:00:00Z") });

// Seed index -> DB id (customers start at 1, orders at 1001).
const orderId = (index: number) => 1001 + index;
const customerId = (index: number) => 1 + index;

beforeAll(async () => {
  db = await createTestDb();
  await runMigrations(db.pool);
  await insertSeedData(db.pool, data);
});

afterAll(async () => {
  await db.cleanup();
});

describe("getOrder", () => {
  it("returns the order with its items", async () => {
    const seeded = data.orders[0]!;
    const order = await getOrder(db.pool, orderId(0));

    expect(order).toMatchObject({
      id: 1001,
      customerId: customerId(seeded.customerIndex),
      status: seeded.status,
      totalCents: seeded.totalCents,
      shipCity: seeded.shipCity,
      customerNote: seeded.customerNote,
    });
    expect(order!.items.map((i) => i.quantity)).toEqual(seeded.items.map((i) => i.quantity));
    expect(order!.items[0]).toMatchObject({ sku: expect.any(String), name: expect.any(String) });
  });

  it("returns null for an unknown order", async () => {
    expect(await getOrder(db.pool, 999_999)).toBeNull();
  });

  it("sums completed refunds into refundedCents", async () => {
    const index = data.orders.findIndex((o) => o.status === "delivered" && o.refunds.length > 0);
    const expected = data.orders[index]!.refunds.reduce((s, r) => s + r.amountCents, 0);

    const order = await getOrder(db.pool, orderId(index));

    expect(order!.refundedCents).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("reports zero refunded for an order without refunds", async () => {
    const index = data.orders.findIndex((o) => o.refunds.length === 0);
    expect((await getOrder(db.pool, orderId(index)))!.refundedCents).toBe(0);
  });

  it("returns any customer's order (no access control at this layer)", async () => {
    const a = await getOrder(db.pool, orderId(0));
    const b = await getOrder(db.pool, orderId(1));
    expect(a!.customerId).not.toBe(b!.customerId);
  });
});

describe("listOrdersForCustomer", () => {
  it("returns only that customer's orders, newest first", async () => {
    const custIndex = data.orders[60]!.customerIndex;
    const expectedCount = data.orders.filter((o) => o.customerIndex === custIndex).length;

    const orders = await listOrdersForCustomer(db.pool, customerId(custIndex));

    expect(orders).toHaveLength(expectedCount);
    const dates = orders.map((o) => o.createdAt.getTime());
    expect(dates).toEqual([...dates].sort((x, y) => y - x));
    for (const o of orders) {
      const seeded = data.orders[o.id - 1001]!;
      expect(seeded.customerIndex).toBe(custIndex);
      expect(o.itemCount).toBe(seeded.items.length);
    }
  });

  it("respects the limit", async () => {
    const custIndex = data.orders[60]!.customerIndex;
    expect(await listOrdersForCustomer(db.pool, customerId(custIndex), 1)).toHaveLength(1);
  });

  it("returns an empty list for an unknown customer", async () => {
    expect(await listOrdersForCustomer(db.pool, 999_999)).toEqual([]);
  });
});

describe("getShipment", () => {
  it("returns carrier and tracking for a delivered order", async () => {
    const index = data.orders.findIndex((o) => o.status === "delivered");
    const shipment = await getShipment(db.pool, orderId(index));

    expect(shipment).toMatchObject({
      orderId: orderId(index),
      status: "delivered",
      carrier: data.orders[index]!.carrier,
      trackingNumber: data.orders[index]!.trackingNumber,
    });
    expect(shipment!.deliveredAt).toBeInstanceOf(Date);
  });

  it("has no tracking for an order that hasn't shipped", async () => {
    const index = data.orders.findIndex((o) => o.status === "paid");
    const shipment = await getShipment(db.pool, orderId(index));

    expect(shipment).toMatchObject({ status: "paid", carrier: null, trackingNumber: null, shippedAt: null });
  });

  it("returns null for an unknown order", async () => {
    expect(await getShipment(db.pool, 999_999)).toBeNull();
  });
});

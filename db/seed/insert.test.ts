import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate.js";
import { createTestDb, type TestDb } from "../../src/testing/test-db.js";
import { generateSeedData } from "./generate.js";
import { insertSeedData } from "./insert.js";

let db: TestDb;
const data = generateSeedData({ seed: 42, now: new Date("2026-11-16T12:00:00Z") });

beforeEach(async () => {
  db = await createTestDb();
  await runMigrations(db.pool);
});

afterEach(async () => {
  await db.cleanup();
});

const count = async (table: string) =>
  (await db.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

describe("insertSeedData", () => {
  it("inserts all rows and numbers orders from 1001", async () => {
    await insertSeedData(db.pool, data);

    expect(await count("customers")).toBe(data.customers.length);
    expect(await count("products")).toBe(data.products.length);
    expect(await count("orders")).toBe(data.orders.length);
    expect(await count("order_items")).toBe(data.orders.reduce((s, o) => s + o.items.length, 0));

    const { rows } = await db.pool.query("SELECT min(id) AS min, max(id) AS max FROM orders");
    expect(rows[0]).toEqual({ min: 1001, max: 1000 + data.orders.length });
  });

  it("links orders to the right customers", async () => {
    await insertSeedData(db.pool, data);

    const { rows } = await db.pool.query(
      "SELECT c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = 1001",
    );
    expect(rows[0].email).toBe(data.customers[data.orders[0]!.customerIndex]!.email);
  });

  it("stores totals that match order_items", async () => {
    await insertSeedData(db.pool, data);

    const { rows } = await db.pool.query(`
      SELECT o.id FROM orders o
      JOIN order_items i ON i.order_id = o.id
      GROUP BY o.id, o.total_cents
      HAVING o.total_cents <> sum(i.quantity * i.unit_price_cents)
    `);
    expect(rows).toEqual([]);
  });

  it("is re-runnable: a second seed replaces data and restarts IDs", async () => {
    await insertSeedData(db.pool, data);
    await insertSeedData(db.pool, data);

    expect(await count("orders")).toBe(data.orders.length);
    const { rows } = await db.pool.query("SELECT min(id) AS min FROM orders");
    expect(rows[0].min).toBe(1001);
  });
});

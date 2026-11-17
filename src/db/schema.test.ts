import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db.js";
import { runMigrations } from "./migrate.js";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await runMigrations(db.pool);
});

afterEach(async () => {
  await db.cleanup();
});

async function insertCustomer(email = "a@example.com"): Promise<number> {
  const { rows } = await db.pool.query(
    "INSERT INTO customers (email, full_name) VALUES ($1, 'Test User') RETURNING id",
    [email],
  );
  return rows[0].id;
}

async function insertOrder(customerId: number, overrides: { status?: string; total_cents?: number } = {}) {
  const { rows } = await db.pool.query(
    `INSERT INTO orders (customer_id, status, total_cents, ship_line1, ship_city, ship_postal_code, ship_country)
     VALUES ($1, $2, $3, '1 Main St', 'Austin', '78701', 'US') RETURNING id`,
    [customerId, overrides.status ?? "paid", overrides.total_cents ?? 5000],
  );
  return rows[0].id as number;
}

const insertRefund = (orderId: number, amountCents: number) =>
  db.pool.query(
    "INSERT INTO refunds (order_id, amount_cents, reason, status) VALUES ($1, $2, 'x', 'completed')",
    [orderId, amountCents],
  );

describe("001_init schema", () => {
  it("numbers orders starting from 1001", async () => {
    expect(await insertOrder(await insertCustomer())).toBe(1001);
  });

  it("rejects duplicate customer emails", async () => {
    await insertCustomer("dup@example.com");
    await expect(insertCustomer("dup@example.com")).rejects.toThrow(/unique/i);
  });

  it("rejects an unknown order status", async () => {
    const customerId = await insertCustomer();
    await expect(insertOrder(customerId, { status: "teleported" })).rejects.toThrow(/check constraint/i);
  });

  it("rejects an order for a customer that doesn't exist", async () => {
    await expect(insertOrder(999_999)).rejects.toThrow(/foreign key/i);
  });

  it("rejects zero or negative money amounts", async () => {
    const customerId = await insertCustomer();
    await expect(insertOrder(customerId, { total_cents: 0 })).rejects.toThrow(/check constraint/i);

    const orderId = await insertOrder(customerId);
    await expect(insertRefund(orderId, -500)).rejects.toThrow(/check constraint/i);
  });

  // Documents a deliberate gap: cross-row limits belong to the permission layer.
  it("does not block a refund larger than the order total", async () => {
    const orderId = await insertOrder(await insertCustomer(), { total_cents: 5000 });
    await expect(insertRefund(orderId, 999_999)).resolves.toBeDefined();
  });
});

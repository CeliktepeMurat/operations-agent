import type pg from "pg";
import type { SeedData } from "./generate.js";

/** Replaces all company data with `data` in a single transaction. IDs restart from 1 (orders from 1001). */
export async function insertSeedData(pool: pg.Pool, data: SeedData): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "TRUNCATE refunds, payments, order_items, orders, products, customers RESTART IDENTITY",
    );

    const customerIds: number[] = [];
    for (const c of data.customers) {
      const { rows } = await client.query<{ id: number }>(
        "INSERT INTO customers (email, full_name) VALUES ($1, $2) RETURNING id",
        [c.email, c.fullName],
      );
      customerIds.push(rows[0]!.id);
    }

    const productIds: number[] = [];
    for (const p of data.products) {
      const { rows } = await client.query<{ id: number }>(
        "INSERT INTO products (sku, name, price_cents) VALUES ($1, $2, $3) RETURNING id",
        [p.sku, p.name, p.priceCents],
      );
      productIds.push(rows[0]!.id);
    }

    for (const o of data.orders) {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO orders (customer_id, status, total_cents,
           ship_line1, ship_city, ship_postal_code, ship_country,
           carrier, tracking_number, customer_note, created_at, shipped_at, delivered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id`,
        [customerIds[o.customerIndex], o.status, o.totalCents,
          o.shipLine1, o.shipCity, o.shipPostalCode, o.shipCountry,
          o.carrier, o.trackingNumber, o.customerNote, o.createdAt, o.shippedAt, o.deliveredAt],
      );
      const orderId = rows[0]!.id;

      for (const it of o.items) {
        await client.query(
          "INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES ($1, $2, $3, $4)",
          [orderId, productIds[it.productIndex], it.quantity, it.unitPriceCents],
        );
      }
      for (const p of o.payments) {
        await client.query(
          "INSERT INTO payments (order_id, amount_cents, status, provider_ref, created_at) VALUES ($1, $2, $3, $4, $5)",
          [orderId, p.amountCents, p.status, p.providerRef, p.createdAt],
        );
      }
      for (const r of o.refunds) {
        await client.query(
          `INSERT INTO refunds (order_id, amount_cents, reason, status, provider_ref, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [orderId, r.amountCents, r.reason, r.status, r.providerRef, r.createdAt],
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

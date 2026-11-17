import type pg from "pg";

// Company backend: plain data access, no access control.
// Ownership and other rules are enforced by the permission layer, not here.

export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled";

export type OrderItem = {
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
};

export type Order = {
  id: number;
  customerId: number;
  status: OrderStatus;
  totalCents: number;
  refundedCents: number;
  shipLine1: string;
  shipCity: string;
  shipPostalCode: string;
  shipCountry: string;
  carrier: string | null;
  trackingNumber: string | null;
  customerNote: string | null;
  createdAt: Date;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  items: OrderItem[];
};

export type OrderSummary = {
  id: number;
  status: OrderStatus;
  totalCents: number;
  itemCount: number;
  createdAt: Date;
};

export type Shipment = {
  orderId: number;
  status: OrderStatus;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  shipLine1: string;
  shipCity: string;
  shipPostalCode: string;
  shipCountry: string;
};

export async function getOrder(pool: pg.Pool, orderId: number): Promise<Order | null> {
  const { rows } = await pool.query<Omit<Order, "items">>(
    `SELECT o.id,
            o.customer_id      AS "customerId",
            o.status,
            o.total_cents      AS "totalCents",
            COALESCE((SELECT sum(r.amount_cents) FROM refunds r
                      WHERE r.order_id = o.id AND r.status = 'completed'), 0)::bigint AS "refundedCents",
            o.ship_line1       AS "shipLine1",
            o.ship_city        AS "shipCity",
            o.ship_postal_code AS "shipPostalCode",
            o.ship_country     AS "shipCountry",
            o.carrier,
            o.tracking_number  AS "trackingNumber",
            o.customer_note    AS "customerNote",
            o.created_at       AS "createdAt",
            o.shipped_at       AS "shippedAt",
            o.delivered_at     AS "deliveredAt"
       FROM orders o
      WHERE o.id = $1`,
    [orderId],
  );
  const order = rows[0];
  if (!order) return null;

  const items = await pool.query<OrderItem>(
    `SELECT p.sku, p.name, i.quantity, i.unit_price_cents AS "unitPriceCents"
       FROM order_items i
       JOIN products p ON p.id = i.product_id
      WHERE i.order_id = $1
      ORDER BY i.id`,
    [orderId],
  );

  return { ...order, items: items.rows };
}

/** Newest first. */
export async function listOrdersForCustomer(pool: pg.Pool, customerId: number, limit = 20): Promise<OrderSummary[]> {
  const { rows } = await pool.query<OrderSummary>(
    `SELECT o.id,
            o.status,
            o.total_cents AS "totalCents",
            (SELECT count(*) FROM order_items i WHERE i.order_id = o.id)::int AS "itemCount",
            o.created_at  AS "createdAt"
       FROM orders o
      WHERE o.customer_id = $1
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT $2`,
    [customerId, limit],
  );
  return rows;
}

export async function getShipment(pool: pg.Pool, orderId: number): Promise<Shipment | null> {
  const { rows } = await pool.query<Shipment>(
    `SELECT id               AS "orderId",
            status,
            carrier,
            tracking_number  AS "trackingNumber",
            shipped_at       AS "shippedAt",
            delivered_at     AS "deliveredAt",
            ship_line1       AS "shipLine1",
            ship_city        AS "shipCity",
            ship_postal_code AS "shipPostalCode",
            ship_country     AS "shipCountry"
       FROM orders
      WHERE id = $1`,
    [orderId],
  );
  return rows[0] ?? null;
}

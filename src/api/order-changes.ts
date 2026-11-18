import type pg from "pg";
import { z } from "zod";
import type { PaymentProvider } from "./payments.js";
import { refundOrder, type RefundOutcome } from "./refunds.js";

// Enforces only what the order lifecycle makes possible (e.g. no cancelling a
// shipped order). Who may do it, and when, is the permission layer's job.

// Orders that haven't shipped yet: they can still be cancelled or redirected.
const CANCELLABLE = ["pending", "paid"];

export type CancelOutcome =
  | { ok: true; refund: RefundOutcome | null } // refund is null when nothing was paid
  | { ok: false; error: string };

export async function cancelOrder(
  pool: pg.Pool,
  payments: PaymentProvider,
  orderId: number,
): Promise<CancelOutcome> {
  const current = await pool.query<{ status: string; totalCents: number; refundedCents: number }>(
    `SELECT status,
            total_cents AS "totalCents",
            COALESCE((SELECT sum(amount_cents) FROM refunds
                      WHERE order_id = $1 AND status = 'completed'), 0)::bigint AS "refundedCents"
       FROM orders WHERE id = $1`,
    [orderId],
  );
  const order = current.rows[0];
  if (!order) return { ok: false, error: `Order ${orderId} not found` };
  if (!CANCELLABLE.includes(order.status)) {
    return { ok: false, error: `Order ${orderId} is ${order.status} and can no longer be cancelled` };
  }

  // Conditional update: if two cancels race, only one can match, so only one refunds.
  const updated = await pool.query(
    "UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = ANY($2)",
    [orderId, CANCELLABLE],
  );
  if (updated.rowCount === 0) {
    return { ok: false, error: `Order ${orderId} changed while cancelling; please check its status` };
  }

  const remaining = order.totalCents - order.refundedCents;
  if (order.status !== "paid" || remaining <= 0) return { ok: true, refund: null };

  const refund = await refundOrder(pool, payments, { orderId, amountCents: remaining, reason: "Order cancelled" });
  return { ok: true, refund };
}

const field = (max: number) => z.string().trim().min(1).max(max);

export const AddressSchema = z.strictObject({
  line1: field(200),
  city: field(100),
  postalCode: field(20),
  country: z.string().trim().regex(/^[A-Z]{2}$/, "Use a 2-letter country code, e.g. US"),
});

export type Address = z.infer<typeof AddressSchema>;

export type AddressChangeOutcome = { ok: true; address: Address } | { ok: false; error: string };

/** Changes where an order ships. Only possible before it ships. */
export async function changeShippingAddress(
  pool: pg.Pool,
  orderId: number,
  newAddress: unknown,
): Promise<AddressChangeOutcome> {
  const parsed = AddressSchema.safeParse(newAddress);
  if (!parsed.success) return { ok: false, error: `Invalid address: ${z.prettifyError(parsed.error)}` };
  const address = parsed.data;

  const current = await pool.query<{ status: string }>("SELECT status FROM orders WHERE id = $1", [orderId]);
  const status = current.rows[0]?.status;
  if (!status) return { ok: false, error: `Order ${orderId} not found` };
  if (!CANCELLABLE.includes(status)) {
    return { ok: false, error: `Order ${orderId} is ${status}; its address can no longer be changed` };
  }

  // Same guard as cancel: the order must still be unshipped at the moment of writing.
  const updated = await pool.query(
    `UPDATE orders
        SET ship_line1 = $2, ship_city = $3, ship_postal_code = $4, ship_country = $5
      WHERE id = $1 AND status = ANY($6)`,
    [orderId, address.line1, address.city, address.postalCode, address.country, CANCELLABLE],
  );
  if (updated.rowCount === 0) {
    return { ok: false, error: `Order ${orderId} changed while updating; please check its status` };
  }

  return { ok: true, address };
}

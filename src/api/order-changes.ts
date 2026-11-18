import type pg from "pg";
import type { PaymentProvider } from "./payments.js";
import { refundOrder, type RefundOutcome } from "./refunds.js";

// Enforces only what the order lifecycle makes possible (e.g. no cancelling a
// shipped order). Who may do it, and when, is the permission layer's job.

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

import type pg from "pg";
import type { PaymentProvider } from "./payments.js";

// No business rules here (ownership, limits, time window): those belong to the
// permission layer. This function only performs a refund correctly.

export type RefundRequest = {
  orderId: number;
  amountCents: number;
  reason: string;
};

export type RefundOutcome =
  | { ok: true; refundId: number; amountCents: number; providerRef: string }
  | { ok: false; error: string };

export async function refundOrder(
  pool: pg.Pool,
  payments: PaymentProvider,
  { orderId, amountCents, reason }: RefundRequest,
): Promise<RefundOutcome> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: `Invalid refund amount: ${amountCents}` };
  }

  const order = await pool.query("SELECT 1 FROM orders WHERE id = $1", [orderId]);
  if (order.rowCount === 0) return { ok: false, error: `Order ${orderId} not found` };

  const payment = await pool.query<{ providerRef: string }>(
    `SELECT provider_ref AS "providerRef" FROM payments
      WHERE order_id = $1 AND status = 'captured'
      ORDER BY id LIMIT 1`,
    [orderId],
  );
  const paymentRef = payment.rows[0]?.providerRef;
  if (!paymentRef) return { ok: false, error: `Order ${orderId} has no captured payment to refund` };

  // 1. Record intent before any money moves.
  const pending = await pool.query<{ id: number }>(
    `INSERT INTO refunds (order_id, amount_cents, reason, status)
     VALUES ($1, $2, $3, 'pending') RETURNING id`,
    [orderId, amountCents, reason],
  );
  const refundId = pending.rows[0]!.id;

  // 2. Move the money. If this throws, the row stays 'pending': outcome unknown, needs a human.
  const result = await payments.refund(paymentRef, amountCents);

  // 3. Record the outcome.
  if (!result.ok) {
    await pool.query("UPDATE refunds SET status = 'failed' WHERE id = $1", [refundId]);
    return { ok: false, error: `Payment provider declined the refund: ${result.error}` };
  }

  await pool.query("UPDATE refunds SET status = 'completed', provider_ref = $2 WHERE id = $1", [
    refundId,
    result.providerRef,
  ]);
  return { ok: true, refundId, amountCents, providerRef: result.providerRef };
}

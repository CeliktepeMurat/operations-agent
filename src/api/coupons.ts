import { randomInt } from "node:crypto";
import type pg from "pg";

// No limits here (amount caps, how many per customer): permission layer's job.

const VALID_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
// No 0/O or 1/I/L, so codes are easy to read out loud.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type Coupon = {
  code: string;
  customerId: number;
  amountCents: number;
  expiresAt: Date;
};

export type CouponOutcome = { ok: true; coupon: Coupon } | { ok: false; error: string };

export function generateCouponCode(): string {
  const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return `THR-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export async function createCoupon(
  pool: pg.Pool,
  { customerId, amountCents, reason, now = new Date() }: { customerId: number; amountCents: number; reason: string; now?: Date },
): Promise<CouponOutcome> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: `Invalid coupon amount: ${amountCents}` };
  }
  if (!reason.trim()) return { ok: false, error: "A reason is required" };

  const customer = await pool.query("SELECT 1 FROM customers WHERE id = $1", [customerId]);
  if (customer.rowCount === 0) return { ok: false, error: `Customer ${customerId} not found` };

  const coupon: Coupon = {
    code: generateCouponCode(),
    customerId,
    amountCents,
    expiresAt: new Date(now.getTime() + VALID_DAYS * DAY_MS),
  };

  await pool.query(
    `INSERT INTO coupons (code, customer_id, amount_cents, reason, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [coupon.code, customerId, amountCents, reason.trim(), now, coupon.expiresAt],
  );

  return { ok: true, coupon };
}

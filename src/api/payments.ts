import { randomUUID } from "node:crypto";

// Every money movement goes through this interface (CLAUDE.md invariant #4),
// so the fake provider can later be swapped for a real one (e.g. x402).

export type RefundResult = { ok: true; providerRef: string } | { ok: false; error: string };

export interface PaymentProvider {
  /** Sends `amountCents` back for the payment identified by `paymentRef`. */
  refund(paymentRef: string, amountCents: number): Promise<RefundResult>;
}

export type FakeRefund = { paymentRef: string; amountCents: number; providerRef: string };

/** In-memory provider. Records every refund it "sends"; can be told to fail. */
export class FakePaymentProvider implements PaymentProvider {
  readonly sent: FakeRefund[] = [];

  constructor(private readonly options: { failWith?: string } = {}) {}

  async refund(paymentRef: string, amountCents: number): Promise<RefundResult> {
    if (this.options.failWith) return { ok: false, error: this.options.failWith };
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return { ok: false, error: `Invalid refund amount: ${amountCents}` };
    }

    const providerRef = `fake_rfd_${randomUUID()}`;
    this.sent.push({ paymentRef, amountCents, providerRef });
    return { ok: true, providerRef };
  }

  /** Total money sent out so far — "how much did we lose?" in evals. */
  totalSentCents(): number {
    return this.sent.reduce((sum, r) => sum + r.amountCents, 0);
  }
}

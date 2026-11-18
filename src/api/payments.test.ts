import { describe, expect, it } from "vitest";
import { FakePaymentProvider } from "./payments.js";

describe("FakePaymentProvider", () => {
  it("succeeds with a unique provider reference and records the refund", async () => {
    const provider = new FakePaymentProvider();

    const a = await provider.refund("pay_000001", 1900);
    const b = await provider.refund("pay_000002", 500);

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.providerRef).not.toBe(b.providerRef);
    expect(provider.sent.map((r) => r.amountCents)).toEqual([1900, 500]);
    expect(provider.totalSentCents()).toBe(2400);
  });

  it("can be told to fail, and then sends nothing", async () => {
    const provider = new FakePaymentProvider({ failWith: "Card network unavailable" });

    expect(await provider.refund("pay_000001", 1900)).toEqual({ ok: false, error: "Card network unavailable" });
    expect(provider.totalSentCents()).toBe(0);
  });

  it.each([0, -500, 12.5])("rejects invalid amount %s", async (amount) => {
    const provider = new FakePaymentProvider();

    const result = await provider.refund("pay_000001", amount);

    expect(result.ok).toBe(false);
    expect(provider.sent).toEqual([]);
  });
});

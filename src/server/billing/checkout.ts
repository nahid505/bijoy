// Checkout and payment verification for subscriptions:
//   Select plan → checkout (PaymentTransaction INITIATED, amount from the database) → provider
//   → callback / webhook → server-side verification → finalizePayment (subscription, invoice, features)
// Duplicate protection: an open checkout for the same plan/cycle/provider is reused (30 min), a
// transaction becomes SUCCESS only once (compare-and-set), a gateway transaction id is unique per
// provider, and a manual TrxID already used by another payment is refused.
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { UserError } from "@/lib/errors";
import type { Cycle } from "@/lib/subscription";
import { reserveAttempt } from "../services/login-guard";
import { checkoutAmounts, failPayment, finalizePayment } from "../services/subscriptions";
import { billingProvider, BillingProviderError, type CallbackResult } from "./providers";

const REUSE_MS = 30 * 60_000;

export async function startCheckout(input: { businessId: string; userId: string; planId: string; cycle: Cycle; provider: string; baseUrl: string; now?: Date }) {
  const now = input.now ?? new Date();
  const provider = billingProvider(input.provider);
  if (!provider || !provider.configured()) throw new UserError("এই পেমেন্ট মাধ্যম এখন চালু নেই");
  const amounts = await checkoutAmounts(input.planId, input.cycle);
  if (amounts.total <= 0) throw new UserError("ফ্রি প্ল্যানের জন্য পেমেন্ট লাগে না");
  const until = await reserveAttempt(prisma, `billing:checkout:${input.businessId}`, { max: 10, windowMs: 60 * 60_000, lockMs: 30 * 60_000 }, now);
  if (until) throw new UserError("অনেকবার পেমেন্ট শুরু করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন");

  const open = await prisma.paymentTransaction.findFirst({
    where: { businessId: input.businessId, planId: input.planId, billingCycle: input.cycle, provider: provider.id, status: provider.kind === "manual" ? { in: ["INITIATED"] } : "INITIATED", amount: amounts.total, createdAt: { gt: new Date(now.getTime() - REUSE_MS) } },
    orderBy: { createdAt: "desc" },
  });
  const txn = open ?? (await prisma.paymentTransaction.create({ data: { businessId: input.businessId, planId: input.planId, billingCycle: input.cycle, provider: provider.id, amount: amounts.total, currency: amounts.currency, initiatedById: input.userId } }));
  if (provider.kind === "manual") return { transaction: txn, redirectUrl: `/billing/manual?txn=${txn.id}` };

  const business = await prisma.business.findUniqueOrThrow({ where: { id: input.businessId }, select: { name: true, mobile: true } });
  try {
    const r = await provider.checkout!({ transactionId: txn.id, amount: num(txn.amount), currency: txn.currency, description: `${amounts.plan.nameEn} (${input.cycle})`, customer: { name: business.name, mobile: business.mobile }, baseUrl: input.baseUrl });
    if (r.providerPaymentId) await prisma.paymentTransaction.update({ where: { id: txn.id }, data: { providerPaymentId: r.providerPaymentId } });
    return { transaction: txn, redirectUrl: r.redirectUrl };
  } catch (e) {
    await failPayment(txn.id, `checkout failed: ${(e as Error).message}`);
    throw new UserError("পেমেন্ট গেটওয়েতে সংযোগ করা যায়নি — একটু পরে আবার চেষ্টা করুন");
  }
}

/** Manual transfer: the customer reports the TrxID; a super admin verifies it later. */
export async function submitManualReference(businessId: string, transactionId: string, reference: string) {
  const ref = reference.trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,40}$/.test(ref)) throw new UserError("সঠিক ট্রানজেকশন আইডি (TrxID) দিন", { reference: ["সঠিক ট্রানজেকশন আইডি দিন"] });
  const t = await prisma.paymentTransaction.findFirst({ where: { id: transactionId, businessId, provider: "manual" } });
  if (!t) throw new UserError("লেনদেন পাওয়া যায়নি");
  if (t.status !== "INITIATED") throw new UserError("এই লেনদেনের তথ্য আগেই জমা দেওয়া হয়েছে");
  const used = await prisma.paymentTransaction.findFirst({ where: { manualReference: ref, status: { in: ["PENDING", "SUCCESS"] }, id: { not: t.id } }, select: { id: true } });
  if (used) throw new UserError("এই TrxID আগেই ব্যবহার করা হয়েছে", { reference: ["এই TrxID আগেই ব্যবহার করা হয়েছে"] });
  const [updated] = await prisma.$transaction([
    prisma.paymentTransaction.update({ where: { id: t.id }, data: { status: "PENDING", manualReference: ref } }),
    prisma.subscription.updateMany({ where: { businessId }, data: { paymentStatus: "PENDING" } }),
  ]);
  return updated;
}

/**
 * Verifies a provider callback / webhook and applies it. Returns our transaction id and outcome.
 * Invalid signatures / unknown transactions throw BillingProviderError (answered with 400).
 */
export async function processProviderResult(providerId: string, params: Record<string, string>) {
  const provider = billingProvider(providerId);
  if (!provider?.verify || !provider.configured()) throw new BillingProviderError("unknown provider");
  const r: CallbackResult = await provider.verify(params);
  const txn = r.transactionId
    ? await prisma.paymentTransaction.findUnique({ where: { id: r.transactionId } })
    : r.providerPaymentId ? await prisma.paymentTransaction.findFirst({ where: { provider: providerId, providerPaymentId: r.providerPaymentId } }) : null;
  if (!txn || txn.provider !== providerId) throw new BillingProviderError("transaction not found");
  const raw = (r.raw ?? {}) as Prisma.InputJsonValue;
  if (r.outcome === "SUCCESS") {
    try {
      await finalizePayment(txn.id, { providerTrxId: r.providerTrxId ?? null, providerPaymentId: r.providerPaymentId ?? null, amount: r.amount ?? NaN, raw });
    } catch (e) {
      if (e instanceof UserError) return { transactionId: txn.id, outcome: "FAILED" as const, message: e.message };
      throw e;
    }
    return { transactionId: txn.id, outcome: "SUCCESS" as const };
  }
  if (r.outcome === "PENDING") return { transactionId: txn.id, outcome: "PENDING" as const };
  await failPayment(txn.id, r.reason ?? r.outcome, { raw, cancelled: r.outcome === "CANCELLED" });
  return { transactionId: txn.id, outcome: r.outcome };
}

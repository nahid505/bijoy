import type { Metadata } from "next";
import { randomBytes } from "node:crypto";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { billingProvider, mockSignature } from "@/server/billing/providers";

export const metadata: Metadata = { title: "টেস্ট পেমেন্ট গেটওয়ে" };

/**
 * DEVELOPMENT ONLY: stands in for a real gateway (BILLING_MOCK=true, refused in production). Its
 * links carry an HMAC signature that the callback verifies — exactly like a real gateway's proof.
 */
export default async function MockGatewayPage({ searchParams }: { searchParams: SearchParams }) {
  if (!billingProvider("mock")?.configured()) notFound();
  const ctx = await requirePermission("billing:manage");
  const { txn } = await readParams(searchParams);
  const t = txn ? await prisma.paymentTransaction.findFirst({ where: { id: txn, businessId: ctx.business.id, provider: "mock" }, include: { plan: true } }) : null;
  if (!t) notFound();
  const amount = num(t.amount).toFixed(2);
  const link = (outcome: string) => {
    const trx = outcome === "SUCCESS" ? `MOCK${randomBytes(5).toString("hex").toUpperCase()}` : "";
    const sig = mockSignature({ txn: t.id, outcome, trx, amount });
    return `/api/billing/callback/mock?${new URLSearchParams({ txn: t.id, outcome, trx, amount, sig })}`;
  };
  return (
    <div className="mx-auto mt-8 max-w-md rounded-xl border-2 border-dashed border-amber-400 bg-white p-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">টেস্ট গেটওয়ে — আসল টাকা কাটা হবে না</p>
      <h1 className="mt-2 text-xl font-bold text-ink-900">{t.plan.nameBn}</h1>
      <p className="mt-1 text-3xl font-bold tabular-nums">{formatMoney(num(t.amount), "৳")}</p>
      <div className="mt-6 flex flex-col gap-2">
        <a href={link("SUCCESS")} className="btn-primary">পরিশোধ করুন (সফল)</a>
        <a href={link("FAILED")} className="btn-secondary">ব্যর্থ পেমেন্ট</a>
        <a href={link("CANCELLED")} className="btn-ghost">বাতিল</a>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { submitManualPaymentAction } from "@/server/actions/billing";

export const metadata: Metadata = { title: "ম্যানুয়াল পেমেন্ট" };

/** Instructions come from BILLING_MANUAL_INSTRUCTIONS (e.g. merchant bKash number / bank account). */
export default async function ManualPaymentPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("billing:manage");
  const { txn } = await readParams(searchParams);
  const t = txn ? await prisma.paymentTransaction.findFirst({ where: { id: txn, businessId: ctx.business.id, provider: "manual" }, include: { plan: true } }) : null;
  if (!t) notFound();
  const instructions = process.env.BILLING_MANUAL_INSTRUCTIONS || "বিজয় লেনদেনের অফিসিয়াল বিকাশ/নগদ মার্চেন্ট নম্বর বা ব্যাংক হিসাবে টাকা পাঠিয়ে নিচে ট্রানজেকশন আইডি (TrxID) লিখুন।";
  return (
    <>
      <PageHeader title="ম্যানুয়াল পেমেন্ট" description={`${t.plan.nameBn} — ${formatMoney(num(t.amount), "৳")}`} crumbs={[{ label: "সাবস্ক্রিপশন", href: "/billing" }, { label: "ম্যানুয়াল পেমেন্ট" }]} />
      <section className="panel max-w-xl space-y-4 p-5">
        <div className="rounded-md bg-ink-50 p-3 text-sm">
          <p className="font-medium">পরিশোধ করুন: <b className="tabular-nums">{formatMoney(num(t.amount), "৳")}</b></p>
          <p className="mt-1 whitespace-pre-line text-slate-700">{instructions}</p>
          <p className="mt-1 text-xs text-slate-500">রেফারেন্স হিসেবে লিখুন: <code>{t.id.slice(-8).toUpperCase()}</code></p>
        </div>
        {t.status === "INITIATED" ? (
          <ActionForm action={submitManualPaymentAction.bind(null, t.id)} className="space-y-3">
            <Field label="ট্রানজেকশন আইডি (TrxID) *" name="reference"><input id="reference" name="reference" className="input font-mono uppercase" placeholder="যেমন 9GH7K2LMN0" autoComplete="off" /></Field>
            <div className="flex gap-2"><SubmitButton>জমা দিন</SubmitButton><Link prefetch={false} href="/billing" className="btn-secondary">পরে দেব</Link></div>
          </ActionForm>
        ) : (
          <p className="text-sm">এই পেমেন্টের অবস্থা: <b>{t.status}</b>{t.manualReference ? ` (TrxID ${t.manualReference})` : ""}</p>
        )}
        <p className="text-xs text-slate-500">যাচাইয়ের পর (সাধারণত কয়েক ঘণ্টার মধ্যে) সাবস্ক্রিপশন চালু হবে এবং ইনভয়েস তৈরি হবে।</p>
      </section>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "পেমেন্টের ফলাফল" };

/** The database decides what is shown — never the URL. */
export default async function PaymentResultPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("billing:view");
  const p = await readParams(searchParams);
  const t = p.txn ? await prisma.paymentTransaction.findFirst({ where: { id: p.txn, businessId: ctx.business.id }, include: { plan: true, subscriptionPayment: { include: { invoice: true } } } }) : null;
  const status = t?.status ?? (p.outcome === "INVALID" ? "INVALID" : "UNKNOWN");
  const view: Record<string, { icon: string; title: string; text: string }> = {
    SUCCESS: { icon: "✅", title: "পেমেন্ট সফল", text: "সাবস্ক্রিপশন চালু হয়েছে এবং প্ল্যানের ফিচারগুলো এখন ব্যবহার করা যাবে।" },
    PENDING: { icon: "⏳", title: "যাচাই চলছে", text: "পেমেন্টের তথ্য পাওয়া গেছে — যাচাইয়ের পর সাবস্ক্রিপশন চালু হবে।" },
    INITIATED: { icon: "⏳", title: "পেমেন্ট সম্পন্ন হয়নি", text: "গেটওয়ে থেকে নিশ্চিতকরণ পাওয়া যায়নি। আবার চেষ্টা করুন।" },
    FAILED: { icon: "❌", title: "পেমেন্ট ব্যর্থ", text: t?.failureReason ? `কারণ: ${t.failureReason}` : "টাকা কাটা হয়নি বা যাচাই করা যায়নি।" },
    CANCELLED: { icon: "↩️", title: "পেমেন্ট বাতিল", text: "আপনি পেমেন্ট বাতিল করেছেন — কোনো টাকা কাটা হয়নি।" },
    INVALID: { icon: "⚠️", title: "যাচাই করা যায়নি", text: "পেমেন্টের তথ্য যাচাই করা যায়নি। টাকা কাটা হয়ে থাকলে সহায়তায় যোগাযোগ করুন।" },
    UNKNOWN: { icon: "❔", title: "লেনদেন পাওয়া যায়নি", text: "" },
  };
  const v = view[status] ?? view.UNKNOWN;
  const inv = t?.subscriptionPayment?.invoice;
  return (
    <section className="panel mx-auto mt-6 max-w-lg p-8 text-center" aria-live="polite">
      <p className="text-5xl">{v.icon}</p>
      <h1 className="mt-3 text-xl font-bold text-ink-900">{v.title}</h1>
      {t && <p className="mt-1 text-sm text-slate-600">{t.plan.nameBn} · {formatMoney(num(t.amount), "৳")}{t.providerTrxId ? ` · TrxID ${t.providerTrxId}` : ""}</p>}
      <p className="mt-2 text-sm text-slate-600">{v.text}</p>
      {inv && <p className="mt-2 text-sm">ইনভয়েস <b>{inv.number}</b> · মেয়াদ {formatDate(inv.periodEnd)} পর্যন্ত</p>}
      <div className="mt-6 flex justify-center gap-2">
        {inv && <Link prefetch={false} href={`/billing/invoices/${inv.id}`} className="btn-primary">ইনভয়েস দেখুন</Link>}
        <Link prefetch={false} href="/billing" className="btn-secondary">সাবস্ক্রিপশন</Link>
      </div>
    </section>
  );
}

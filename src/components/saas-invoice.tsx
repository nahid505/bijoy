// Subscription invoice (A4 / "Save as PDF" from the browser print dialog). PDF architecture: the page is
// print-ready HTML; a server-side renderer (e.g. a headless browser job) can print the same route.
import { formatDate, formatMoney } from "@/lib/format";
import { AmountInWords } from "@/components/amount-words";
import { CYCLE_LABELS } from "@/lib/subscription";

export interface SaasInvoiceView {
  number: string;
  createdAt: Date;
  status: string;
  billingCycle: "MONTHLY" | "YEARLY";
  periodStart: Date;
  periodEnd: Date;
  subtotal: number;
  discount: number;
  vatPercent: number;
  vatAmount: number;
  total: number;
  paymentMethod: string | null;
  transactionRef: string | null;
  paidAt: Date | null;
  planName: string;
  billTo: { name?: string; address?: string | null; mobile?: string | null; email?: string | null; binNumber?: string | null; tinNumber?: string | null };
}

export function SaasInvoice({ inv }: { inv: SaasInvoiceView }) {
  const seller = { name: process.env.PLATFORM_NAME || "বিজয় লেনদেন", address: process.env.PLATFORM_ADDRESS || "", bin: process.env.PLATFORM_BIN || "" };
  return (
    <article className="panel print-area mx-auto max-w-[210mm] bg-white p-8 text-sm" aria-label={`ইনভয়েস ${inv.number}`}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-ink-900">{seller.name}</h1>
          {seller.address && <p className="text-xs text-slate-600">{seller.address}</p>}
          {seller.bin && <p className="text-xs text-slate-600">BIN: {seller.bin}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-ink-900">ইনভয়েস</p>
          <p>নং: <b>{inv.number}</b></p>
          <p>তারিখ: {formatDate(inv.createdAt)}</p>
          <p className="mt-1 font-semibold">{inv.status === "PAID" ? "পরিশোধিত" : inv.status}</p>
        </div>
      </header>
      <section className="grid gap-4 py-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">বিল প্রাপক</p>
          <p className="font-semibold">{inv.billTo.name}</p>
          {inv.billTo.address && <p className="text-xs text-slate-600">{inv.billTo.address}</p>}
          <p className="text-xs text-slate-600">{[inv.billTo.mobile, inv.billTo.email].filter(Boolean).join(" · ")}</p>
          {(inv.billTo.binNumber || inv.billTo.tinNumber) && <p className="text-xs text-slate-600">{[inv.billTo.binNumber && `BIN: ${inv.billTo.binNumber}`, inv.billTo.tinNumber && `TIN: ${inv.billTo.tinNumber}`].filter(Boolean).join(" · ")}</p>}
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase text-slate-500">পেমেন্ট</p>
          <p>মাধ্যম: {inv.paymentMethod ?? "—"}</p>
          <p>ট্রানজেকশন আইডি: <span className="font-mono">{inv.transactionRef ?? "—"}</span></p>
          <p>পরিশোধের তারিখ: {inv.paidAt ? formatDate(inv.paidAt) : "—"}</p>
        </div>
      </section>
      <table className="w-full border-collapse">
        <thead><tr className="border-b border-ink-800 text-left"><th className="py-1.5">বিবরণ</th><th className="py-1.5">সময়কাল</th><th className="py-1.5 text-right">টাকা</th></tr></thead>
        <tbody>
          <tr className="border-b border-rule">
            <td className="py-2">{inv.planName} প্ল্যান — {CYCLE_LABELS[inv.billingCycle]} সাবস্ক্রিপশন</td>
            <td className="py-2">{formatDate(inv.periodStart)} — {formatDate(inv.periodEnd)}</td>
            <td className="py-2 text-right tabular-nums">{formatMoney(inv.subtotal, "৳")}</td>
          </tr>
        </tbody>
        <tfoot>
          {inv.discount > 0 && <tr><td colSpan={2} className="py-1 text-right">ছাড়</td><td className="py-1 text-right tabular-nums">−{formatMoney(inv.discount, "৳")}</td></tr>}
          <tr><td colSpan={2} className="py-1 text-right">ভ্যাট ({inv.vatPercent}%)</td><td className="py-1 text-right tabular-nums">{formatMoney(inv.vatAmount, "৳")}</td></tr>
          <tr className="border-t-2 border-ink-800 text-base font-bold"><td colSpan={2} className="py-2 text-right">মোট</td><td className="py-2 text-right tabular-nums">{formatMoney(inv.total, "৳")}</td></tr>
        </tfoot>
      </table>
      <p className="mt-3 text-xs">কথায়: <AmountInWords amount={inv.total} /></p>
      <p className="mt-8 text-center text-xs text-slate-500">এটি কম্পিউটারে তৈরি ইনভয়েস — স্বাক্ষরের প্রয়োজন নেই।</p>
    </article>
  );
}

export function toInvoiceView(i: {
  number: string; createdAt: Date; status: string; billingCycle: "MONTHLY" | "YEARLY"; periodStart: Date; periodEnd: Date; subtotal: unknown; discount: unknown; vatPercent: unknown;
  vatAmount: unknown; total: unknown; paymentMethod: string | null; transactionRef: string | null; paidAt: Date | null; billTo: unknown; plan: { nameBn: string };
}): SaasInvoiceView {
  const n = (v: unknown) => Number(v);
  return {
    number: i.number, createdAt: i.createdAt, status: i.status, billingCycle: i.billingCycle, periodStart: i.periodStart, periodEnd: i.periodEnd,
    subtotal: n(i.subtotal), discount: n(i.discount), vatPercent: n(i.vatPercent), vatAmount: n(i.vatAmount), total: n(i.total),
    paymentMethod: i.paymentMethod, transactionRef: i.transactionRef, paidAt: i.paidAt, planName: i.plan.nameBn, billTo: (i.billTo ?? {}) as SaasInvoiceView["billTo"],
  };
}

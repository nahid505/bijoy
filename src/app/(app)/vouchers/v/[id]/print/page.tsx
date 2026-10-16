import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { num } from "@/lib/db";
import { TRADE_TYPES, VOUCHER_TYPES } from "@/lib/accounting";
import { paymentStatus, PAYMENT_STATUS_LABELS, round2 } from "@/lib/calc";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { PrintButton } from "@/components/forms";
import { PaddySlip } from "@/components/paddy-slip";
import { amountInBanglaWords } from "@/lib/words";
import { can, requireContext } from "@/server/auth";
import { batchesOfItem, loadVoucher } from "@/server/voucher-detail";
import { voucherPermission } from "@/server/voucher-permissions";

export const metadata: Metadata = { title: "প্রিন্ট" };

/** Printable voucher / invoice (A4, "Save as PDF" from the browser print dialog). */
export default async function VoucherPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const v = await loadVoucher(ctx.business.id, id);
  if (!v) notFound();
  if (!can(ctx, voucherPermission(v.type, "view")) && !(v.type === "OPENING" && can(ctx, "accounts:view"))) redirect("/forbidden");
  const b = ctx.business;
  const cur = b.currencySymbol;
  const meta = VOUCHER_TYPES[v.type];
  const trade = TRADE_TYPES.includes(v.type);
  const party = v.partyAccount?.customer ?? v.partyAccount?.supplier;
  const amount = num(v.amount);
  const paid = num(v.paidAmount);
  const title = v.paddyPurchase ? "ধান ক্রয় চালান" : v.type === "SALES" ? "ইনভয়েস / বিল" : v.type === "RECEIPT" ? "মানি রিসিপ্ট" : meta.long;
  const dr = round2(v.entries.reduce((s, e) => s + num(e.debit), 0));

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <PrintButton label="প্রিন্ট / PDF" />
        <Link prefetch={false} href={`/vouchers/v/${v.id}`} className="btn-secondary">← ভাউচারে ফিরুন</Link>
      </div>

      <article className="panel print-area mx-auto max-w-[210mm] bg-white p-8 text-sm">
        <header className="flex items-start justify-between gap-6 border-b-2 border-ink-800 pb-4">
          <div className="flex items-start gap-3">
            {b.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logo} alt="" className="h-14 w-14 object-contain" />
            )}
            <div>
              <h1 className="text-xl font-bold text-ink-900">{b.name}</h1>
              {b.address && <p className="whitespace-pre-line text-xs text-slate-600">{b.address}</p>}
              <p className="text-xs text-slate-600">{[b.mobile, b.email].filter(Boolean).join(" · ")}</p>
              {(b.binNumber || b.tinNumber) && <p className="text-xs text-slate-600">{[b.binNumber && `BIN: ${b.binNumber}`, b.tinNumber && `TIN: ${b.tinNumber}`].filter(Boolean).join(" · ")}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-ink-900">{title}</p>
            <p className="mt-1">নং: <b>{v.voucherNo}</b></p>
            <p>তারিখ: {formatDate(v.date)}</p>
            {v.reference && <p>রেফারেন্স: {v.reference}</p>}
            {trade && <p className="mt-1 font-semibold">{PAYMENT_STATUS_LABELS[paymentStatus(amount, paid)]}</p>}
          </div>
        </header>

        {v.partyAccount && (
          <section className="py-4">
            <p className="text-xs font-semibold text-slate-500">{v.type === "SALES" || v.type === "SALES_RETURN" ? "কাস্টমার" : v.type === "PURCHASE" || v.type === "PURCHASE_RETURN" ? "সরবরাহকারী" : "পার্টি/হিসাব"}</p>
            <p className="text-base font-semibold">{v.partyAccount.name}</p>
            {party?.address && <p className="text-slate-600">{party.address}</p>}
            {party?.mobile && <p className="text-slate-600">{party.mobile}</p>}
          </section>
        )}

        {v.paddyPurchase && <PaddySlip currency={cur} d={{ bagCount: v.paddyPurchase.bagCount, grossKg: num(v.paddyPurchase.grossKg), dhaltaKg: num(v.paddyPurchase.dhaltaKg), netKg: num(v.paddyPurchase.netKg), mon: num(v.paddyPurchase.mon), ratePerMon: num(v.paddyPurchase.ratePerMon), totalPrice: num(v.paddyPurchase.totalPrice), notes: v.paddyPurchase.notes }} />}

        {v.items.length > 0 ? (
          <div className="mt-2 overflow-x-auto print:overflow-visible"><table className="w-full border-collapse">
            <thead>
              <tr className="border-y-2 border-ink-800 bg-ink-50 text-left text-xs">
                <th className="px-2 py-1.5">ক্রম</th>
                <th className="px-2 py-1.5">পণ্যের বিবরণ</th>
                <th className="px-2 py-1.5 text-right">পরিমাণ</th>
                <th className="px-2 py-1.5 text-right">দর</th>
                {trade && <th className="px-2 py-1.5 text-right">ছাড়</th>}
                <th className="px-2 py-1.5 text-right">টাকা</th>
              </tr>
            </thead>
            <tbody>
              {v.items.map((i, idx) => (
                <tr key={i.id} className="border-b border-rule">
                  <td className="px-2 py-1.5">{toBnDigits(idx + 1)}</td>
                  <td className="px-2 py-1.5">
                    {i.product.name}{v.type === "STOCK_JOURNAL" && ` (${i.direction === 1 ? "আগমন" : "বাহির"} — ${i.warehouse?.name})`}
                    {batchesOfItem(i, formatDate, formatQty) && <span className="block text-[11px] text-slate-500">ব্যাচ: {batchesOfItem(i, formatDate, formatQty)}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(num(i.quantity))} {i.unit?.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(num(i.rate), cur)}</td>
                  {trade && <td className="px-2 py-1.5 text-right tabular-nums">{num(i.discount) ? formatMoney(num(i.discount), cur) : ""}</td>}
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(num(i.amount), cur)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <div className="mt-2 overflow-x-auto print:overflow-visible"><table className="w-full border-collapse">
            <thead>
              <tr className="border-y-2 border-ink-800 bg-ink-50 text-left text-xs">
                <th className="px-2 py-1.5">হিসাব</th>
                <th className="px-2 py-1.5">বিবরণ</th>
                <th className="px-2 py-1.5 text-right">ডেবিট</th>
                <th className="px-2 py-1.5 text-right">ক্রেডিট</th>
              </tr>
            </thead>
            <tbody>
              {v.entries.map((e) => (
                <tr key={e.id} className="border-b border-rule">
                  <td className="px-2 py-1.5">{e.account.name}</td>
                  <td className="px-2 py-1.5 text-slate-600">{e.narration}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{num(e.debit) ? formatMoney(num(e.debit), cur) : ""}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{num(e.credit) ? formatMoney(num(e.credit), cur) : ""}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-double border-ink-800 font-bold">
                <td className="px-2 py-1.5" colSpan={2}>মোট</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(dr, cur)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(dr, cur)}</td>
              </tr>
            </tbody>
          </table></div>
        )}

        {trade && (
          <div className="mt-4 flex justify-end">
            <dl className="w-72 space-y-1">
              <Line label="উপমোট" value={formatMoney(num(v.subtotal), cur)} />
              {num(v.discount) > 0 && <Line label="ছাড়" value={`− ${formatMoney(num(v.discount), cur)}`} />}
              {num(v.vatAmount) > 0 && <Line label={`ভ্যাট (${formatQty(num(v.vatPercent))}%)`} value={formatMoney(num(v.vatAmount), cur)} />}
              <div className="flex justify-between border-t-2 border-double border-ink-800 pt-1 text-base font-bold"><dt>সর্বমোট</dt><dd className="tabular-nums">{formatMoney(amount, cur)}</dd></div>
              {v.payments.length ? v.payments.map((pm) => <Line key={pm.id} label={`পরিশোধ — ${pm.account.name}${pm.reference ? ` (${pm.reference})` : ""}`} value={formatMoney(num(pm.amount), cur)} />) : <Line label="পরিশোধিত" value={formatMoney(paid, cur)} />}
              <Line label="বাকি" value={formatMoney(amount - paid, cur)} strong />
            </dl>
          </div>
        )}

        <p className="mt-4 rounded border border-rule bg-ink-50 px-3 py-2 text-sm"><b>কথায়:</b> {amountInBanglaWords(amount)}</p>
        {v.dueDate && amount - paid > 0 && <p className="mt-2 text-sm">বাকি পরিশোধের শেষ তারিখ: <b>{formatDate(v.dueDate)}</b></p>}
        {v.returnOf && <p className="mt-2 text-sm">মূল ইনভয়েস: {v.returnOf.voucherNo}</p>}
        {v.narration && v.narration !== v.paddyPurchase?.notes && <p className="mt-2 text-slate-600">বিবরণ: {v.narration}</p>}
        {v.type === "SALES" && b.invoiceTerms && <p className="mt-3 whitespace-pre-line text-xs text-slate-500">{b.invoiceTerms}</p>}

        <footer className="mt-16 grid grid-cols-3 gap-8 text-center text-xs text-slate-600">
          <div className="border-t border-slate-500 pt-1">{v.type === "SALES" ? "কাস্টমারের স্বাক্ষর" : "গ্রহীতার স্বাক্ষর"}</div>
          <div className="border-t border-slate-500 pt-1">প্রস্তুতকারী ({v.createdBy.name})</div>
          <div className="border-t border-slate-500 pt-1">অনুমোদনকারী</div>
        </footer>
        {v.type === "SALES" && b.invoiceFooter && <p className="mt-6 text-center text-xs text-slate-500">{b.invoiceFooter}</p>}
      </article>
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}>
      <dt className="text-slate-600">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

// Dealer copy of a depot delivery challan (A4 or 80 mm POS slip). Every line shows its rate — the saved
// challan rate (the product's purchase price at delivery; a market sale's own sale rate) — and
// amount = supplied quantity × rate; free goods are never priced. Never the depot's internal figures
// (commission). On a DO release the dealer paid the company, so there is no collection / due.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { DEPOT_ACCESS, isDepot } from "@/lib/depot";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { amountInBanglaWords } from "@/lib/words";
import { PrintButton } from "@/components/forms";
import { can, requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { challanLineRate, loadDepotDelivery } from "@/server/services/depot";
import { DepotOnlyNotice } from "../../../depot-ui";
import { PosPageSize } from "./pos-page-size";
import { canSeeVoucher } from "@/server/party-scope";

export const metadata: Metadata = { title: "ডেলিভারি চালান — ডিলার কপি" };

export default async function DealerChallanPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const ctx = await requirePermission(DEPOT_ACCESS.view);
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  const d = await loadDepotDelivery(ctx.business.id, id);
  if (!d || !(await canSeeVoucher(ctx, id))) notFound(); // assigned-only roles: their parties only
  const pos = (await readParams(searchParams)).format === "pos";
  const b = ctx.business;
  const cur = b.currencySymbol;
  const v = d.voucher;
  const doRelease = d.mode === "COMPANY_PAID";
  const lines = v.items.map((i) => {
    const supplied = num(i.quantity);
    const free = num(i.freeQuantity);
    const rate = challanLineRate(d.mode, i);
    return { id: i.id, name: i.product.name, code: i.product.code ?? "", unit: i.product.unit.name, supplied, free, total: round3(supplied + free), rate, amount: round2(supplied * rate) };
  });
  const units = [...new Set(lines.map((l) => l.unit))];
  const sum = (k: "supplied" | "free" | "total") => round3(lines.reduce((s, l) => s + l[k], 0));
  const qtyTotal = (k: "supplied" | "free" | "total") => (units.length === 1 ? `${formatQty(sum(k))} ${units[0]}` : formatQty(sum(k)));
  const amount = round2(lines.reduce((t, l) => t + l.amount, 0));
  const paid = doRelease ? 0 : num(v.paidAmount);
  const dealer = d.dealerAccount;
  const route = dealer?.customer?.route;
  const money = (n: number) => formatMoney(n, cur);
  const priceCell = (n: number) => money(n);

  const toolbar = (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      <PrintButton label="প্রিন্ট / PDF" />
      <span className="inline-flex overflow-hidden rounded-md border border-rule text-sm" role="group" aria-label="প্রিন্ট ফরম্যাট">
        <Link prefetch={false} href={`/depot/deliveries/${v.id}/print`} aria-current={!pos ? "page" : undefined} className={`px-3 py-1.5 ${!pos ? "bg-brand-600 font-semibold text-white" : "bg-white hover:bg-brand-50"}`}>A4</Link>
        <Link prefetch={false} href={`/depot/deliveries/${v.id}/print?format=pos`} aria-current={pos ? "page" : undefined} className={`border-l border-rule px-3 py-1.5 ${pos ? "bg-brand-600 font-semibold text-white" : "bg-white hover:bg-brand-50"}`}>POS স্লিপ (৮০ মিমি)</Link>
      </span>
      <Link prefetch={false} href={`/vouchers/v/${v.id}`} className="btn-secondary">← চালানে ফিরুন</Link>
      <span className="text-xs text-slate-500">ডিলার কপিতে কমিশন বা অভ্যন্তরীণ কোনো হিসাব থাকে না</span>
    </div>
  );

  const meta = (
    <>
      <p>চালান নং: <b>{v.voucherNo}</b></p>
      <p>তারিখ: {formatDate(v.date)}</p>
      {d.doNumber && <p>{doRelease ? "ডিও নং" : "রেফারেন্স"}: <b>{d.doNumber}</b></p>}
    </>
  );
  const footerInfo = (
    <>
      {d.notes && <p><b>নোট:</b> {d.notes}</p>}
      {(d.driverName || d.vehicleNo) && <p>{d.driverName && <>ড্রাইভার: <b>{d.driverName}</b></>}{d.driverName && d.vehicleNo && " · "}{d.vehicleNo && <>গাড়ি নম্বর: <b>{d.vehicleNo}</b></>}</p>}
    </>
  );

  if (pos) {
    return (
      <>
        {toolbar}
        <PosPageSize targetId="challan-slip" />
        <article id="challan-slip" className="challan-slip print-area mx-auto w-[76mm] bg-white p-2 text-[11px] leading-snug text-black shadow print:w-full print:p-0 print:shadow-none">
          <header className="border-b border-dashed border-black pb-1 text-center">
            <p className="text-sm font-bold">{b.name}</p>
            {b.address && <p className="text-[10px]">{b.address}</p>}
            {b.mobile && <p className="text-[10px]">{b.mobile}</p>}
            <p className="mt-1 text-[12px] font-bold">ডেলিভারি চালান (ডিলার কপি)</p>
          </header>
          <div className="border-b border-dashed border-black py-1">
            {meta}
            <p>ডিলার: <b>{dealer?.name ?? "নগদ বিক্রয়"}</b>{route ? ` (${route})` : ""}</p>
            {dealer?.customer?.mobile && <p>মোবাইল: {dealer.customer.mobile}</p>}
          </div>
          <ol className="divide-y divide-dashed divide-black">
            {lines.map((l, i) => (
              <li key={l.id} className="py-1">
                <p className="font-semibold">{toBnDigits(i + 1)}. {l.name}{l.code && <span className="font-normal"> ({l.code})</span>}</p>
                <p className="flex justify-between gap-2">
                  <span>সরবরাহ {formatQty(l.supplied)}{l.free > 0 && <> + <b className="rounded-sm bg-black px-0.5 text-white">ফ্রি {formatQty(l.free)}</b></>} = <b>{formatQty(l.total)} {l.unit}</b></span>
                </p>
                <p className="flex justify-between gap-2"><span>দর {priceCell(l.rate)}</span><b className="tabular-nums">{priceCell(l.amount)}</b></p>
              </li>
            ))}
          </ol>
          <div className="space-y-0.5 border-y border-black py-1">
            <p className="flex justify-between"><span>মোট সরবরাহ</span><b>{qtyTotal("supplied")}</b></p>
            <p className="flex justify-between"><span>মোট ফ্রি</span><b>{qtyTotal("free")}</b></p>
            <p className="flex justify-between"><span>মোট পরিমাণ</span><b>{qtyTotal("total")}</b></p>
            <p className="flex justify-between text-[12px]"><span className="font-bold">মোট টাকা</span><b className="tabular-nums">{money(amount)}</b></p>
            {doRelease ? (
              <p className="pt-0.5 text-[10px]">মূল্য কোম্পানির ডিও অনুযায়ী কোম্পানিতে পরিশোধিত</p>
            ) : (
              <>
                <p className="flex justify-between"><span>আজ পরিশোধ</span><span className="tabular-nums">{money(paid)}</span></p>
                <p className="flex justify-between"><span>বাকি</span><b className="tabular-nums">{money(round2(amount - paid))}</b></p>
              </>
            )}
          </div>
          <p className="py-1 text-[10px]"><b>কথায়:</b> {amountInBanglaWords(amount)}</p>
          <div className="py-1 text-[10px]">{footerInfo}</div>
          <div className="mt-6 grid grid-cols-2 gap-3 text-center text-[10px]">
            <p className="border-t border-black pt-0.5">ডিপো প্রতিনিধি</p>
            <p className="border-t border-black pt-0.5">ডিলারের স্বাক্ষর</p>
          </div>
        </article>
      </>
    );
  }

  return (
    <>
      {toolbar}
      <article id="challan-a4" className="panel print-area mx-auto max-w-[210mm] bg-white p-8 text-sm">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink-800 pb-4">
          <div className="flex items-start gap-3">
            {b.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={b.logo} alt="" className="h-14 w-14 object-contain" />
            )}
            <div>
              <h1 className="text-xl font-bold text-ink-900">{b.name}</h1>
              {b.address && <p className="whitespace-pre-line text-xs text-slate-600">{b.address}</p>}
              <p className="text-xs text-slate-600">{[b.mobile, b.email].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-ink-900">ডেলিভারি চালান</p>
            <p className="text-xs font-semibold text-slate-500">ডিলার কপি</p>
            <div className="mt-1">{meta}</div>
          </div>
        </header>

        <section className="grid gap-4 py-4 sm:grid-cols-2 print:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-slate-500">ডিলার</p>
            <p className="text-base font-semibold">{dealer?.name ?? "নগদ বিক্রয়"}</p>
            {route && <p className="text-slate-600">রুট / এরিয়া: {route}</p>}
            {dealer?.customer?.mobile && <p className="text-slate-600">{dealer.customer.mobile}</p>}
          </div>
          {doRelease && (
            <div className="sm:text-right print:text-right">
              <p className="text-xs font-semibold text-slate-500">সরবরাহের ভিত্তি</p>
              <p className="font-semibold">কোম্পানির ডিও{d.companyAccount ? ` — ${d.companyAccount.name}` : ""}</p>
              <p className="text-slate-600">মূল্য কোম্পানিতে পরিশোধিত</p>
            </div>
          )}
        </section>

        <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full min-w-[46rem] border-collapse print:min-w-0" id="dealer-lines">
          <thead>
            <tr className="border-y-2 border-ink-800 bg-ink-50 text-xs">
              <th className="px-2 py-1.5 text-left">ক্রমিক নং</th>
              <th className="px-2 py-1.5 text-left">পণ্যের কোড</th>
              <th className="px-2 py-1.5 text-left">পণ্যের নাম</th>
              <th className="px-2 py-1.5 text-right">সরবরাহ পরিমাণ</th>
              <th className="bg-amber-100 px-2 py-1.5 text-right print:bg-amber-100">ফ্রি পরিমাণ</th>
              <th className="px-2 py-1.5 text-right">মোট পরিমাণ</th>
              <th className="px-2 py-1.5 text-right">দর / রেট</th>
              <th className="px-2 py-1.5 text-right">মোট টাকা</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id} className="border-b border-rule">
                <td className="px-2 py-1.5">{toBnDigits(i + 1)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 font-mono text-xs">{l.code || "—"}</td>
                <td className="px-2 py-1.5">{l.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatQty(l.supplied)} {l.unit}</td>
                <td className="bg-amber-50 px-2 py-1.5 text-right font-bold tabular-nums text-amber-900 print:bg-amber-50">{l.free > 0 ? `${formatQty(l.free)} ${l.unit}` : "০"}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{formatQty(l.total)} {l.unit}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{priceCell(l.rate)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{priceCell(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink-800 font-bold" id="dealer-totals">
              <td className="px-2 py-1.5" colSpan={3}>মোট</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{qtyTotal("supplied")}</td>
              <td className="bg-amber-50 px-2 py-1.5 text-right tabular-nums text-amber-900 print:bg-amber-50">{qtyTotal("free")}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{qtyTotal("total")}</td>
              <td />
              <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums" id="dealer-total">{money(amount)}</td>
            </tr>
          </tfoot>
        </table>
        </div>

        <div className="mt-3 flex justify-end">
          <dl className="w-72 space-y-1">
            <div className="flex justify-between font-bold"><dt>সর্বমোট টাকা</dt><dd className="tabular-nums">{money(amount)}</dd></div>
            {doRelease ? (
              <div className="flex justify-between text-slate-600"><dt>পরিশোধ</dt><dd>কোম্পানির ডিও-তে</dd></div>
            ) : (
              <>
                <div className="flex justify-between"><dt>আজ পরিশোধ</dt><dd className="tabular-nums">{money(paid)}</dd></div>
                <div className="flex justify-between border-t border-ink-800 pt-1 font-bold"><dt>বাকি</dt><dd className="tabular-nums">{money(round2(amount - paid))}</dd></div>
              </>
            )}
          </dl>
        </div>
        <p className="mt-4 rounded border border-rule bg-ink-50 px-3 py-2 text-sm"><b>কথায়:</b> {amountInBanglaWords(amount)}</p>
        <div className="mt-3 space-y-1 text-sm">{footerInfo}</div>

        <footer className="mt-16 grid grid-cols-2 gap-16 text-center text-xs text-slate-600">
          <div className="border-t border-slate-500 pt-1">ডিপো প্রতিনিধির স্বাক্ষর</div>
          <div className="border-t border-slate-500 pt-1">ডিলারের স্বাক্ষর</div>
        </footer>
      </article>
    </>
  );
}

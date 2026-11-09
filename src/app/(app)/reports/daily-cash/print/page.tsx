import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { formatMoney, formatReportDateBangla, toBnDigits } from "@/lib/format";
import { AutoPrint, PrintButton } from "@/components/forms";
import { PrintHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { cashLineDetail, cashScopeAccounts, dailyCash, type CashLine } from "@/server/reports/daily-cash";
import { getT } from "@/server/i18n";
import { reportOpenFor } from "@/server/reports/registry";

export const metadata: Metadata = { title: "ডেইলী জমা-খরচ হিসাব — প্রিন্ট" };

// a ruled khata: crisp black borders and bold text for printing
const CELL = "border border-black px-1.5 py-1 align-top font-semibold text-black";
const AMOUNT_PRINT = "print:text-[17px] print:font-bold";

export default async function DailyCashPrintPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("accounts:view");
  if (!reportOpenFor(ctx, "daily-cash")) redirect("/forbidden");
  const p = await readParams(searchParams);
  const [d, { all }] = await Promise.all([dailyCash(ctx.business.id, { date: p.date, scope: p.scope }), cashScopeAccounts(ctx.business.id)]);
  const cur = ctx.business.currencySymbol;
  const money = (n: number) => formatMoney(n, cur);
  const t = await getT();

  const detail = (l: CashLine) =>
    cashLineDetail(l, (n) => (Math.abs(n) < 0.005 ? money(0) : `${money(Math.abs(n))} ${t(n > 0 ? "ডেবিট" : "ক্রেডিট")}`), t("বর্তমান জের:"));
  const accounts = all;
  const selectedAccountName =
    accounts.find((a) => a.id === d.scope)?.name ||
    (d.scope === "cash-bank" ? "সকল নগদ ও ব্যাংক হিসাব" : "নগদ ক্যাশ");
  const formattedDate = formatReportDateBangla(d.date);
  const heading = `ডেইলী জমা খরচ হিসাব ------- ${selectedAccountName} ------ ${formattedDate}`;
  const bodyRows = Math.max(d.receipts.length + 1, d.payments.length, 6);

  return (
    <div className="mx-auto max-w-5xl py-4 font-sans text-black print:p-0 print:m-0 print:max-w-none">
      <AutoPrint />

      {/* নো-প্রিন্ট কন্ট্রোল বার */}
      <div className="no-print mb-4 flex items-center justify-between border-b pb-3 px-2">
        <div className="flex items-center gap-2">
          <PrintButton label="🖨 প্রিন্ট / PDF" />
          <Link prefetch={false} href={`/reports/daily-cash?date=${d.date}${d.scope !== "cash" ? `&scope=${encodeURIComponent(d.scope)}` : ""}`} className="btn-secondary">
            ← রিপোর্টে ফিরুন
          </Link>
        </div>
        <p className="text-sm font-medium text-slate-600">{formattedDate}</p>
      </div>

      <div className="print-area p-4 print:p-0">
        <PrintHeader business={ctx.business} title="ডেইলী জমা-খরচ হিসাব" heading={heading} />

        <CashBook
          opening={d.opening}
          receipts={d.receipts}
          payments={d.payments}
          rows={bodyRows}
          money={money}
          detail={detail}
          totals={{ todayReceipts: d.todayReceipts, totalReceipts: d.totalReceipts, totalPayments: d.totalPayments, closing: d.closing }}
        />

        <div className="signature-section mt-14 print:break-inside-avoid">
          <div className="grid grid-cols-3 gap-8 text-center text-xs font-bold text-black">
            {["ক্যাশিয়ার", "হিসাবরক্ষক", "অনুমোদনকারী"].map((s) => <p key={s} className="border-t border-black pt-1">{s}</p>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Particulars({ l, detail }: { l: CashLine; detail: (l: CashLine) => string }) {
  const balance = detail({ ...l, narration: null });
  const note = l.narration?.trim();
  return (
    <>
      <span className="block font-medium text-black print:font-bold print:text-black">
        {l.particulars}
        {l.address && <>, <span data-keep-lang>{l.address}</span></>}
        {l.enteredBy && <span className="font-normal text-slate-700 print:text-black"> (<span data-keep-lang>{l.enteredBy}</span>)</span>}
      </span>
      {(balance || note) && (
        <span className="block text-xs text-slate-600 print:text-black">
          {balance}
          {note && <>{balance ? ", " : ""}<span data-keep-lang>{note}</span></>}
        </span>
      )}
    </>
  );
}

type Cells = { no: React.ReactNode; text: React.ReactNode; amount: React.ReactNode; cls?: string } | { note: string };

function CashBook({
  opening, receipts, payments, rows, money, detail, totals,
}: {
  opening: number;
  receipts: CashLine[];
  payments: CashLine[];
  rows: number;
  money: (n: number) => string;
  detail: (l: CashLine) => string;
  totals: { todayReceipts: number; totalReceipts: number; totalPayments: number; closing: number };
}) {
  const line = (l: CashLine, i: number): Cells => ({ no: toBnDigits(i + 1), text: <Particulars l={l} detail={detail} />, amount: money(l.amount) });
  const left: Cells[] = payments.length ? payments.map(line) : [{ note: "আজ কোনো পেমেন্ট নেই" }];
  const right: Cells[] = [
    { no: "—", text: <span className="font-semibold">পূর্বের জমা (প্রারম্ভিক ব্যালেন্স)</span>, amount: money(opening), cls: "font-semibold bg-amber-50/60 print:bg-white" },
    ...(receipts.length ? receipts.map(line) : [{ note: "আজ কোনো রিসিট নেই" }]),
  ];
  const n = Math.max(rows, left.length, right.length);
  const mid = "border-l-2 border-l-black";
  const top = "border-t-2 border-t-black";
  const side = (c: Cells | undefined, first: string, key: string) => {
    const ds = key === "l" ? "pay" : "receipt";
    if (!c) return (<Fragment key={key}><td data-side={ds} className={`${CELL} h-7 ${first}`} /><td data-side={ds} className={CELL} /><td data-side={ds} className={CELL} /></Fragment>);
    if ("note" in c) return <td key={key} data-side={ds} colSpan={3} className={`${CELL} ${first} py-2 text-center text-xs text-slate-500`}>{c.note}</td>;
    return (
      <Fragment key={key}>
        <td data-side={ds} className={`${CELL} ${first} text-center tabular-nums ${c.cls ?? ""}`}>{c.no}</td>
        <td data-side={ds} className={`cash-particulars ${CELL} break-words ${c.cls ?? ""}`}>{c.text}</td>
        <td data-side={ds} className={`${CELL} whitespace-nowrap text-right tabular-nums ${AMOUNT_PRINT} ${c.cls ?? ""}`}>{c.amount}</td>
      </Fragment>
    );
  };
  const foot: [string, number | null, string, number | null][] = [
    ["মোট পেমেন্ট", totals.totalPayments, "আজকের রিসিট", totals.todayReceipts],
    ["অবশিষ্ট ক্যাশ (সমাপনী ব্যালেন্স)", totals.closing, "", null],
    ["সর্বমোট", totals.totalReceipts, "মোট রিসিট (পূর্বের জমা + আজকের রিসিট)", totals.totalReceipts],
  ];
  return (
    <table id="cash-book" className="cash-khata w-full table-fixed border-collapse border border-black text-sm print:table print:border-black">
      <colgroup>
        <col className="w-10 print:w-[8mm]" />
        <col />
        <col className="w-32 print:w-[34mm]" />
        <col className="w-10 print:w-[8mm]" />
        <col />
        <col className="w-32 print:w-[34mm]" />
      </colgroup>
      <thead>
        <tr>
          <th data-side="pay" colSpan={3} scope="colgroup" className={`${CELL} bg-red-50 py-1.5 text-center font-bold text-red-900 print:bg-white print:text-black`}>খরচ / পেমেন্ট</th>
          <th data-side="receipt" colSpan={3} scope="colgroup" className={`${CELL} ${mid} bg-emerald-50 py-1.5 text-center font-bold text-emerald-900 print:bg-white print:text-black`}>জমা / রিসিট</th>
        </tr>
        <tr className="bg-slate-100 print:bg-slate-100">
          {[0, 1].map((i) => (
            <Fragment key={i}>
              <th data-side={i ? "receipt" : "pay"} scope="col" className={`${CELL} ${i ? mid : ""} text-center font-semibold`}>নং</th>
              <th data-side={i ? "receipt" : "pay"} scope="col" className={`${CELL} text-left font-semibold`}>বিবরণ</th>
              <th data-side={i ? "receipt" : "pay"} scope="col" className={`${CELL} text-right font-semibold`}>টাকা</th>
            </Fragment>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: n }, (_, i) => {
          const empty = !left[i] && !right[i];
          return (
            <tr key={i} className={empty ? "cash-pad" : undefined} aria-hidden={empty ? true : undefined}>
              {side(left[i], "", "l")}
              {side(right[i], mid, "r")}
            </tr>
          );
        })}
      </tbody>
      <tfoot className="total-row report-summary">
        {foot.map(([ll, lv, rl, rv], i) => (
          <tr key={i} className={i === 2 ? "font-bold" : "font-semibold"}>
            <td data-side="pay" colSpan={2} className={`${CELL} text-right ${i === 2 ? top : ""}`}>{ll}</td>
            <td data-side="pay" className={`${CELL} whitespace-nowrap text-right tabular-nums ${AMOUNT_PRINT} ${i === 1 ? "text-brand-800 print:text-black" : ""} ${i === 2 ? top : ""}`}>{lv === null ? "" : money(lv)}</td>
            <td data-side="receipt" colSpan={2} className={`${CELL} ${mid} text-right ${i === 2 ? top : ""}`}>{rl || " "}</td>
            <td data-side="receipt" className={`${CELL} whitespace-nowrap text-right tabular-nums ${AMOUNT_PRINT} ${i === 2 ? top : ""}`}>{rv === null ? "" : money(rv)}</td>
          </tr>
        ))}
      </tfoot>
    </table>
  );
}

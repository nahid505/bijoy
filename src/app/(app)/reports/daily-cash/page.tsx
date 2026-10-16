import type { Metadata } from "next";
import Link from "next/link";
import { addDays, formatDate, formatMoney, toBnDigits } from "@/lib/format";
import { amountInBanglaWords } from "@/lib/words";
import { PrintButton } from "@/components/forms";
import { FilterField, PageHeader, PrintHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { cashScopeAccounts, dailyCash, type CashLine } from "@/server/reports/daily-cash";

export const metadata: Metadata = { title: "ডেইলী জমা-খরচ হিসাব" };

export default async function DailyCashPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("accounts:view");
  const p = await readParams(searchParams);
  const [d, { all }] = await Promise.all([dailyCash(ctx.business.id, { date: p.date, scope: p.scope }), cashScopeAccounts(ctx.business.id)]);
  const cur = ctx.business.currencySymbol;
  const money = (n: number) => formatMoney(n, cur);
  const q = (date: string) => `/reports/daily-cash?date=${date}${d.scope !== "cash" ? `&scope=${encodeURIComponent(d.scope)}` : ""}`;
  const exportHref = `/api/reports/daily-cash?date=${d.date}&scope=${encodeURIComponent(d.scope)}`;
  // both sides get the same number of body rows, so the totals line up like a cash khata
  const bodyRows = Math.max(d.receipts.length + 1, d.payments.length, 6);

  return (
    <>
      {/* the printed sheet has its own header (PrintHeader) */}
      <div className="no-print">
        <PageHeader
          title="ডেইলী জমা-খরচ হিসাব"
          description="নির্দিষ্ট দিনের পূর্বের জমা, সারাদিনের রিসিট ও পেমেন্ট এবং অবশিষ্ট ক্যাশ — ক্যাশ খাতার মতো দুই কলামে"
          crumbs={[{ label: "রিপোর্ট", href: "/reports" }, { label: "ডেইলী জমা-খরচ হিসাব" }]}
          actions={
            <>
              <PrintButton label="প্রিন্ট / PDF" />
              <a href={`${exportHref}&format=xlsx`} className="btn-secondary">⬇ Excel (XLSX)</a>
              <a href={exportHref} className="btn-secondary">⬇ CSV</a>
            </>
          }
        />
      </div>
      <section className="panel print-area daily-cash">
        <form key={`${d.date}|${d.scope}`} method="get" action="/reports/daily-cash" className="no-print flex flex-wrap items-end gap-2 border-b border-rule p-3">
          <FilterField label="তারিখ">
            <input type="date" id="date" name="date" defaultValue={d.date} className="input w-40" required />
          </FilterField>
          <FilterField label="হিসাব">
            <select id="scope" name="scope" defaultValue={d.scope} className="input w-56">
              <option value="cash">নগদ তহবিল (সব নগদ হিসাব)</option>
              <option value="cash-bank">নগদ ও ব্যাংক (সব)</option>
              {all.map((a) => <option key={a.id} value={a.id}>{a.name}{a.isActive ? "" : " (নিষ্ক্রিয়)"}</option>)}
            </select>
          </FilterField>
          <button type="submit" className="btn-primary">দেখুন</button>
          <span className="ml-auto flex gap-1">
            <Link prefetch={false} href={q(addDays(d.date, -1))} className="btn-ghost" aria-label="আগের দিন">← আগের দিন</Link>
            <Link prefetch={false} href={q(addDays(d.date, 1))} className="btn-ghost" aria-label="পরের দিন">পরের দিন →</Link>
          </span>
        </form>

        <div className="p-4">
          <PrintHeader business={ctx.business} title="ডেইলী জমা-খরচ হিসাব" subtitle={`${formatDate(d.date)} — ${d.scopeLabel}`} />
          <div className="no-print mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-ink-900">তারিখ: {formatDate(d.date)}</h2>
            <p className="text-xs text-slate-500">{d.scopeLabel}{d.accounts.length > 1 ? ` — ${d.accounts.map((a) => a.name).join(", ")}` : ""}</p>
          </div>
          {d.accounts.length === 0 && <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">কোনো নগদ হিসাব নেই</p>}

          <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2 print:gap-0">
            {/* বাম: পেমেন্ট / খরচ */}
            <CashSide
              className="order-2 md:order-1 print:order-1"
              title="খরচ / পেমেন্ট"
              tone="red"
              lines={d.payments}
              bodyRows={bodyRows}
              money={money}
              footer={[
                ["মোট পেমেন্ট", d.totalPayments, "font-semibold"],
                ["অবশিষ্ট ক্যাশ (সমাপনী ব্যালেন্স)", d.closing, "font-semibold text-brand-800"],
                ["সর্বমোট", d.totalReceipts, "font-bold border-t-2 border-ink-800"],
              ]}
            />
            {/* ডান: রিসিট / জমা */}
            <CashSide
              className="order-1 md:order-2 print:order-2"
              title="জমা / রিসিট"
              tone="green"
              opening={d.opening}
              lines={d.receipts}
              bodyRows={bodyRows}
              money={money}
              footer={[
                ["আজকের রিসিট", d.todayReceipts, "font-semibold"],
                ["মোট রিসিট (পূর্বের জমা + আজকের রিসিট)", d.totalReceipts, "font-bold border-t-2 border-ink-800"],
                ["", null, ""],
              ]}
            />
          </div>

          <div className="mt-4 grid gap-2 rounded-lg border border-rule bg-ink-50 p-3 text-sm sm:grid-cols-2 print:grid-cols-2 print:bg-white">
            <p>পূর্বের জমা: <b className="tabular-nums">{money(d.opening)}</b> + আজকের রিসিট: <b className="tabular-nums">{money(d.todayReceipts)}</b> = মোট রিসিট: <b className="tabular-nums">{money(d.totalReceipts)}</b></p>
            <p>মোট রিসিট − মোট পেমেন্ট (<span className="tabular-nums">{money(d.totalPayments)}</span>) = <b>অবশিষ্ট ক্যাশ: <span id="closing" className="tabular-nums">{money(d.closing)}</span></b></p>
            <p className="sm:col-span-2 print:col-span-2"><b>অবশিষ্ট ক্যাশ কথায়:</b> {d.closing < 0 ? "ঋণাত্মক " : ""}{amountInBanglaWords(Math.abs(d.closing))}</p>
          </div>

          <div className="print-only mt-14">
            <div className="grid grid-cols-3 gap-8 text-center text-xs">
              {["ক্যাশিয়ার", "হিসাবরক্ষক", "অনুমোদনকারী"].map((s) => <p key={s} className="border-t border-ink-800 pt-1">{s}</p>)}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function CashSide({
  title, tone, opening, lines, bodyRows, footer, money, className,
}: {
  title: string;
  tone: "green" | "red";
  opening?: number;
  lines: CashLine[];
  bodyRows: number;
  footer: [string, number | null, string][];
  money: (n: number) => string;
  className: string;
}) {
  const filled = lines.length + (opening !== undefined ? 1 : 0);
  return (
    <section className={`${className} min-w-0`} aria-label={title}>
      <table className="w-full border-collapse border border-ink-800 text-sm print:text-[10.5px]">
        <caption className={`border border-b-0 border-ink-800 py-1.5 text-center font-bold ${tone === "green" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"} print:bg-white print:text-black`}>{title}</caption>
        <thead>
          <tr className="bg-ink-50 print:bg-white">
            <th scope="col" className="w-10 border border-ink-800 px-1.5 py-1 text-center">নং</th>
            <th scope="col" className="border border-ink-800 px-1.5 py-1 text-left">বিবরণ</th>
            <th scope="col" className="w-28 border border-ink-800 px-1.5 py-1 text-right">টাকা</th>
          </tr>
        </thead>
        <tbody>
          {opening !== undefined && (
            <tr className="bg-amber-50/60 print:bg-white">
              <td className="border-x border-ink-800 px-1.5 py-1 text-center">—</td>
              <td className="border-x border-ink-800 px-1.5 py-1 font-semibold">পূর্বের জমা (প্রারম্ভিক ব্যালেন্স)</td>
              <td className="border-x border-ink-800 px-1.5 py-1 text-right font-semibold tabular-nums">{money(opening)}</td>
            </tr>
          )}
          {lines.map((l, i) => (
            <tr key={l.voucherId} className="align-top">
              <td className="border-x border-ink-800 px-1.5 py-1 text-center tabular-nums">{toBnDigits(i + 1)}</td>
              <td className="border-x border-ink-800 px-1.5 py-1">
                <span className="block">{l.particulars}</span>
                <span className="block text-xs text-slate-500 print:text-[9px]">
                  <Link prefetch={false} href={`/vouchers/v/${l.voucherId}`} className="text-brand-700 hover:underline print:text-black print:no-underline">{l.voucherNo}</Link> · {l.typeLabel}{l.narration ? ` · ${l.narration}` : ""}
                </span>
              </td>
              <td className="border-x border-ink-800 px-1.5 py-1 text-right tabular-nums">{money(l.amount)}</td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr><td colSpan={3} className="border-x border-ink-800 px-1.5 py-2 text-center text-xs text-slate-500">আজ কোনো {tone === "green" ? "রিসিট" : "পেমেন্ট"} নেই</td></tr>
          )}
          {Array.from({ length: Math.max(0, bodyRows - filled - (lines.length === 0 ? 1 : 0)) }, (_, i) => (
            <tr key={`pad-${i}`} aria-hidden="true"><td className="h-7 border-x border-ink-800" /><td className="border-x border-ink-800" /><td className="border-x border-ink-800" /></tr>
          ))}
        </tbody>
        <tfoot>
          {footer.map(([label, value, cls], i) => (
            <tr key={i} className={cls}>
              <td colSpan={2} className="border border-ink-800 px-1.5 py-1 text-right">{label || " "}</td>
              <td className="border border-ink-800 px-1.5 py-1 text-right tabular-nums">{value === null ? "" : money(value)}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </section>
  );
}

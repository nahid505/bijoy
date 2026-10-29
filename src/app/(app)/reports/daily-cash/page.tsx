import type { Metadata } from "next";
import { Fragment } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { addDays, formatDate, formatMoney, toBnDigits } from "@/lib/format";
import { AmountInWords } from "@/components/amount-words";
import { PrintButton } from "@/components/forms";
import { FilterField, PageHeader, PrintHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { cashLineDetail, cashScopeAccounts, dailyCash, type CashLine } from "@/server/reports/daily-cash";
import { getT } from "@/server/i18n";
import { reportOpenFor } from "@/server/reports/registry";

export const metadata: Metadata = { title: "ডেইলী জমা-খরচ হিসাব" };

export default async function DailyCashPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("accounts:view");
  if (!reportOpenFor(ctx, "daily-cash")) redirect("/forbidden"); // lists every party's cash
  const p = await readParams(searchParams);
  const [d, { all }] = await Promise.all([dailyCash(ctx.business.id, { date: p.date, scope: p.scope }), cashScopeAccounts(ctx.business.id)]);
  const cur = ctx.business.currencySymbol;
  const money = (n: number) => formatMoney(n, cur);
  const t = await getT();
  // বিবরণ row 2: "বীরগঞ্জ, দিনাজপুর, বর্তমান জের: ৳ ৫,০০০.০০ ডেবিট" (debit − credit of the line's account, with its side)
  const detail = (l: CashLine) =>
    cashLineDetail(l, (n) => (Math.abs(n) < 0.005 ? money(0) : `${money(Math.abs(n))} ${t(n > 0 ? "ডেবিট" : "ক্রেডিট")}`), t("বর্তমান জের:"));
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

          {/* desktop and paper: one ruled khata — payment line i and receipt line i share a row, so rows and totals always line up */}
          <CashBook
            opening={d.opening}
            receipts={d.receipts}
            payments={d.payments}
            rows={bodyRows}
            money={money}
            detail={detail}
            totals={{ todayReceipts: d.todayReceipts, totalReceipts: d.totalReceipts, totalPayments: d.totalPayments, closing: d.closing }}
          />
          {/* phones: receipts above payments, each its own table */}
          <div className="grid gap-4 md:hidden print:hidden" id="cash-sides">
            {/* বাম: পেমেন্ট / খরচ */}
            <CashSide
              className="order-2"
              title="খরচ / পেমেন্ট"
              tone="red"
              lines={d.payments}
              bodyRows={bodyRows}
              money={money}
              detail={detail}
              footer={[
                ["মোট পেমেন্ট", d.totalPayments, "font-semibold"],
                ["অবশিষ্ট ক্যাশ (সমাপনী ব্যালেন্স)", d.closing, "font-semibold text-brand-800"],
                ["সর্বমোট", d.totalReceipts, "font-bold border-t-2 border-slate-500"],
              ]}
            />
            {/* ডান: রিসিট / জমা */}
            <CashSide
              className="order-1"
              title="জমা / রিসিট"
              tone="green"
              opening={d.opening}
              lines={d.receipts}
              bodyRows={bodyRows}
              money={money}
              detail={detail}
              footer={[
                ["আজকের রিসিট", d.todayReceipts, "font-semibold"],
                ["মোট রিসিট (পূর্বের জমা + আজকের রিসিট)", d.totalReceipts, "font-bold border-t-2 border-slate-500"],
                ["", null, ""],
              ]}
            />
          </div>

          <div className="mt-4 grid gap-2 rounded-lg border border-rule bg-ink-50 p-3 text-sm sm:grid-cols-2 print:grid-cols-2 print:bg-white">
            <p>পূর্বের জমা: <b className="tabular-nums">{money(d.opening)}</b> + আজকের রিসিট: <b className="tabular-nums">{money(d.todayReceipts)}</b> = মোট রিসিট: <b className="tabular-nums">{money(d.totalReceipts)}</b></p>
            <p>মোট রিসিট − মোট পেমেন্ট (<span className="tabular-nums">{money(d.totalPayments)}</span>) = <b>অবশিষ্ট ক্যাশ: <span id="closing" className="tabular-nums">{money(d.closing)}</span></b></p>
            <p className="sm:col-span-2 print:col-span-2"><b>অবশিষ্ট ক্যাশ কথায়:</b> {d.closing < 0 ? "ঋণাত্মক " : ""}<AmountInWords amount={Math.abs(d.closing)} /></p>
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

// a ruled khata: every cell of every row (the empty filler rows too) has its own light rule; on paper a shade darker
const CELL = "border border-slate-300 px-1.5 py-1 align-top print:border-slate-400";

/**
 * বিবরণ of one ledger:
 *   row 1 "সাইফুল, বীরগঞ্জ, দিনাজপুর (Delower)" — the name opens the voucher; no address → "সাইফুল (Delower)"
 *   row 2 "বর্তমান জের: ৳ ২,৫৫৫.০০ ডেবিট, চাউল ক্রয় বাবদ" — no note → the balance alone; neither → no second row
 * The address, the user's name and the note are data: never translated.
 */
function Particulars({ l, detail }: { l: CashLine; detail: (l: CashLine) => string }) {
  const balance = detail({ ...l, narration: null });
  const note = l.narration?.trim();
  return (
    <>
      <span className="block font-medium text-gray-800 print:text-black">
        <Link prefetch={false} href={`/vouchers/v/${l.voucherId}`} className="text-inherit hover:underline print:no-underline">{l.particulars}</Link>
        {l.address && <>, <span data-keep-lang>{l.address}</span></>}
        {l.enteredBy && <span className="font-normal text-slate-600 print:text-black"> (<span data-keep-lang>{l.enteredBy}</span>)</span>}
      </span>
      {(balance || note) && (
        <span className="block text-xs text-gray-500 print:text-[9.5px] print:text-slate-700">
          {balance}
          {note && <>{balance ? ", " : ""}<span data-keep-lang>{note}</span></>}
        </span>
      )}
    </>
  );
}

type Cells = { no: React.ReactNode; text: React.ReactNode; amount: React.ReactNode; cls?: string } | { note: string };

/** Desktop and print: খরচ / পেমেন্ট (left) and জমা / রিসিট (right) in one table — নং | বিবরণ | টাকা ‖ নং | বিবরণ | টাকা. */
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
  const mid = "border-l-2 border-l-slate-500"; // the rule between the two sides
  const top = "border-t-2 border-t-slate-500"; // above the balancing totals
  const side = (c: Cells | undefined, first: string, key: string) => {
    const ds = key === "l" ? "pay" : "receipt"; // data-side: which half a cell belongs to
    if (!c) return (<Fragment key={key}><td data-side={ds} className={`${CELL} h-7 ${first}`} /><td data-side={ds} className={CELL} /><td data-side={ds} className={CELL} /></Fragment>);
    if ("note" in c) return <td key={key} data-side={ds} colSpan={3} className={`${CELL} ${first} py-2 text-center text-xs text-slate-500`}>{c.note}</td>;
    return (
      <Fragment key={key}>
        <td data-side={ds} className={`${CELL} ${first} text-center tabular-nums ${c.cls ?? ""}`}>{c.no}</td>
        <td data-side={ds} className={`cash-particulars ${CELL} break-words ${c.cls ?? ""}`}>{c.text}</td>
        <td data-side={ds} className={`${CELL} whitespace-nowrap text-right tabular-nums ${c.cls ?? ""}`}>{c.amount}</td>
      </Fragment>
    );
  };
  // footer pairs: the balancing totals (সর্বমোট = মোট রিসিট) share the last row, as in a paper khata
  const foot: [string, number | null, string, number | null][] = [
    ["মোট পেমেন্ট", totals.totalPayments, "আজকের রিসিট", totals.todayReceipts],
    ["অবশিষ্ট ক্যাশ (সমাপনী ব্যালেন্স)", totals.closing, "", null],
    ["সর্বমোট", totals.totalReceipts, "মোট রিসিট (পূর্বের জমা + আজকের রিসিট)", totals.totalReceipts],
  ];
  return (
    <table id="cash-book" className="cash-khata hidden w-full table-fixed border-collapse border border-slate-300 text-sm md:table print:table print:border-slate-400 print:text-[10.5px]">
      {/* fixed widths, the same on both sides: নং narrow, টাকা wide enough for "৳ ১২,৫০,০০০.০০", বিবরণ takes the rest */}
      <colgroup>
        <col className="w-10 print:w-[8mm]" />
        <col />
        <col className="w-32 print:w-[27mm]" />
        <col className="w-10 print:w-[8mm]" />
        <col />
        <col className="w-32 print:w-[27mm]" />
      </colgroup>
      <thead>
        <tr>
          <th data-side="pay" colSpan={3} scope="colgroup" className={`${CELL} bg-red-50 py-1.5 text-center font-bold text-red-900 print:bg-white print:text-black`}>খরচ / পেমেন্ট</th>
          <th data-side="receipt" colSpan={3} scope="colgroup" className={`${CELL} ${mid} bg-emerald-50 py-1.5 text-center font-bold text-emerald-900 print:bg-white print:text-black`}>জমা / রিসিট</th>
        </tr>
        <tr className="bg-slate-50 print:bg-white">
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
      <tfoot>
        {foot.map(([ll, lv, rl, rv], i) => (
          <tr key={i} className={i === 2 ? "font-bold" : "font-semibold"}>
            <td data-side="pay" colSpan={2} className={`${CELL} text-right ${i === 2 ? top : ""}`}>{ll}</td>
            <td data-side="pay" className={`${CELL} whitespace-nowrap text-right tabular-nums ${i === 1 ? "text-brand-800" : ""} ${i === 2 ? top : ""}`}>{lv === null ? "" : money(lv)}</td>
            <td data-side="receipt" colSpan={2} className={`${CELL} ${mid} text-right ${i === 2 ? top : ""}`}>{rl || " "}</td>
            <td data-side="receipt" className={`${CELL} whitespace-nowrap text-right tabular-nums ${i === 2 ? top : ""}`}>{rv === null ? "" : money(rv)}</td>
          </tr>
        ))}
      </tfoot>
    </table>
  );
}

function CashSide({
  title, tone, opening, lines, bodyRows, footer, money, detail, className,
}: {
  title: string;
  tone: "green" | "red";
  opening?: number;
  lines: CashLine[];
  bodyRows: number;
  footer: [string, number | null, string][];
  money: (n: number) => string;
  detail: (l: CashLine) => string;
  className: string;
}) {
  const filled = lines.length + (opening !== undefined ? 1 : 0);
  const cell = CELL;
  return (
    <section className={`${className} min-w-0`} aria-label={title}>
      <table className="cash-khata w-full table-fixed border-collapse border border-slate-300 text-sm print:border-slate-400 print:text-[10.5px]">
        {/* fixed widths: নং narrow, টাকা wide enough for "৳ ১২,৫০,০০০.০০", বিবরণ takes the rest */}
        <colgroup>
          <col className="w-10 print:w-[8mm]" />
          <col />
          <col className="w-32 print:w-[27mm]" />
        </colgroup>
        <caption className={`border border-b-0 border-slate-300 py-1.5 text-center font-bold print:border-slate-400 ${tone === "green" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"} print:bg-white print:text-black`}>{title}</caption>
        <thead>
          <tr className="bg-slate-50 print:bg-white">
            <th scope="col" className={`${cell} text-center font-semibold`}>নং</th>
            <th scope="col" className={`${cell} text-left font-semibold`}>বিবরণ</th>
            <th scope="col" className={`${cell} text-right font-semibold`}>টাকা</th>
          </tr>
        </thead>
        <tbody>
          {opening !== undefined && (
            <tr className="bg-amber-50/60 print:bg-white">
              <td className={`${cell} text-center`}>—</td>
              <td className={`${cell} font-semibold`}>পূর্বের জমা (প্রারম্ভিক ব্যালেন্স)</td>
              <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums`}>{money(opening)}</td>
            </tr>
          )}
          {lines.map((l, i) => (
            <tr key={l.key}>
              <td className={`${cell} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
              <td className={`cash-particulars ${cell} break-words`}><Particulars l={l} detail={detail} /></td>
              <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>{money(l.amount)}</td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr><td colSpan={3} className={`${cell} py-2 text-center text-xs text-slate-500`}>আজ কোনো {tone === "green" ? "রিসিট" : "পেমেন্ট"} নেই</td></tr>
          )}
          {Array.from({ length: Math.max(0, bodyRows - filled - (lines.length === 0 ? 1 : 0)) }, (_, i) => (
            <tr key={`pad-${i}`} aria-hidden="true" className="cash-pad"><td className={`${cell} h-7`} /><td className={cell} /><td className={cell} /></tr>
          ))}
        </tbody>
        <tfoot>
          {footer.map(([label, value, cls], i) => (
            <tr key={i} className={cls}>
              <td colSpan={2} className={`${cell} text-right`}>{label || " "}</td>
              <td className={`${cell} whitespace-nowrap text-right tabular-nums`}>{value === null ? "" : money(value)}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </section>
  );
}

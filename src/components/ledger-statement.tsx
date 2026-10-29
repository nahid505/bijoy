"use client";

// Ledger / খতিয়ান statement (/accounts/[id]): toolbar (back, name, live search, date range, details, type filter, print,
// Excel / CSV, share), a ruled table — date + type badge | বিবরণ | জমা | খরচ | ব্যালেন্স Dr/Cr — and a footer with the
// entry count, the totals and the net পাওনা (Dr) / দেনা (Cr). Phones get the same lines as cards. Rows open the voucher.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { formatMoney, toBnDigits, toDateInput } from "@/lib/format";
import { useLang, useT } from "@/components/lang";
import { useToast } from "@/components/toaster";

export type LedgerType = "OPENING" | "PURCHASE" | "JOURNAL" | "PAYMENT" | "SALES" | "RECEIPT" | "SALES_RETURN" | "PURCHASE_RETURN" | "STOCK_JOURNAL" | "PRODUCTION" | "DEPOT_DELIVERY";

export interface LedgerRow {
  id: string;
  /** formatted date ("৩০ জানুয়ারি ২০২৫") */
  date: string;
  voucherId: string | null;
  voucherNo: string | null;
  type: LedgerType;
  /** the type's (Bangla) label — translated on screen */
  typeLabel: string;
  /** counter ledgers ("ক্রয় a/c", "নগদ ক্যাশ"); empty → the type's long name */
  against: string;
  narration: string | null;
  enteredBy: string | null;
  debit: number;
  credit: number;
  /** running, debit − credit */
  balance: number;
}

// type badges: Opening grey, Purchase navy, Journal maroon, Payment purple, Sale sky, Receipt amber; the rest teal
const BADGE: Partial<Record<LedgerType, string>> = {
  OPENING: "bg-slate-500",
  PURCHASE: "bg-indigo-700",
  PURCHASE_RETURN: "bg-indigo-500",
  JOURNAL: "bg-pink-700",
  PAYMENT: "bg-purple-700",
  SALES: "bg-sky-600",
  SALES_RETURN: "bg-sky-800",
  RECEIPT: "bg-amber-600",
};

export function LedgerStatement({
  name, subtitle, backHref, rows, opening, closing, currency, from, to, fromText, toText, booksFrom, exportHref, canExport, canPrint = true, printHeader,
}: {
  name: string;
  subtitle: string;
  backHref: string;
  rows: LedgerRow[];
  opening: number;
  closing: number;
  currency: string;
  from: string;
  to: string;
  fromText: string;
  toText: string;
  /** first day of the books ("সব" in the date picker) */
  booksFrom: string;
  /** /api/reports/ledger?… (CSV; &format=xlsx for Excel) */
  exportHref: string;
  canExport: boolean;
  /** reports.ledger:print (or accounts:view): the print button; without it the page prints only a notice */
  canPrint?: boolean;
  printHeader: React.ReactNode;
}) {
  const t = useT();
  const en = useLang() === "en";
  // the ledger's columns: জমা / খরচ in Bangla, Credit / Debit in English ("খরচ" alone is "Expense" elsewhere)
  const CR = en ? "Credit" : "জমা";
  const DR = en ? "Debit" : "খরচ";
  const toast = useToast();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [details, setDetails] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [hidden, setHidden] = useState<Set<LedgerType>>(new Set());
  const [range, setRange] = useState({ from, to });
  const searchRef = useRef<HTMLInputElement>(null);

  const money = (n: number) => formatMoney(n, currency);
  const drcr = (n: number) => (Math.abs(n) < 0.005 ? money(0) : `${money(Math.abs(n))} ${n > 0 ? "Dr" : "Cr"}`);
  const types = useMemo(() => [...new Map(rows.map((r) => [r.type, r.typeLabel])).entries()], [rows]);
  const needle = q.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (hidden.has(r.type)) return false;
    if (!needle) return true;
    return [r.voucherNo, r.enteredBy, r.against, r.narration, t(r.typeLabel), r.typeLabel].some((x) => x?.toLowerCase().includes(needle));
  });
  const entries = visible.filter((r) => r.voucherId); // the opening line is not an entry
  const totalCredit = entries.reduce((s, r) => s + r.credit, 0);
  const totalDebit = entries.reduce((s, r) => s + r.debit, 0);
  const filtered = needle !== "" || hidden.size > 0;

  const go = (r: LedgerRow) => r.voucherId && router.push(`/vouchers/v/${r.voucherId}`);
  const applyRange = (f: string, tt: string) => {
    setRangeOpen(false);
    const sp = new URLSearchParams(window.location.search);
    sp.set("from", f);
    sp.set("to", tt);
    router.push(`?${sp.toString()}`);
  };
  const today = toDateInput();
  const share = async () => {
    const url = window.location.href;
    const text = `${name} — ${t("সমাপনী")}: ${drcr(closing)} (${fromText} – ${toText})`;
    try {
      if (navigator.share) await navigator.share({ title: name, text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        toast(t("লিংক কপি হয়েছে"), "success");
      }
    } catch {
      /* the share sheet was closed */
    }
  };
  const badge = (r: LedgerRow) => (
    <span className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none text-white print:border print:border-slate-500 print:bg-transparent print:text-black ${BADGE[r.type] ?? "bg-teal-600"}`}>
      {t(r.typeLabel)}
    </span>
  );
  const describe = (r: LedgerRow) => (
    <>
      <span className="block font-medium text-ink-900">{r.voucherId ? (r.against || t(r.typeLabel)) : t("প্রারম্ভিক ব্যালেন্স")}</span>
      {details && r.voucherId && (
        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          {r.voucherNo && (
            <Link prefetch={false} href={`/vouchers/v/${r.voucherId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs text-amber-500 hover:underline print:text-[8.5px] print:text-black">
              {r.voucherNo}
            </Link>
          )}
          {r.narration && <span className="text-xs text-slate-400 print:text-[8.5px] print:text-slate-600" data-keep-lang>{r.narration}</span>}
          {r.enteredBy && <span className="text-xs font-medium text-emerald-600 print:text-[8.5px] print:text-black" data-keep-lang>{r.enteredBy}</span>}
        </span>
      )}
    </>
  );

  return (
    <div className={canPrint ? "ledger-statement" : "ledger-statement ledger-no-print"}>
      {!canPrint && <p className="print-only text-sm" id="ledger-print-denied">{t("এই খতিয়ান প্রিন্ট করার অনুমতি নেই")}</p>}
      {/* ── toolbar (not printed) */}
      <div className="no-print mb-3 space-y-2">
        <div className="flex items-center gap-2">
          <Link prefetch={false} href={backHref} className="btn-ghost px-2 text-lg" aria-label={t("ফিরে যান")}>←</Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-ink-900">{name}</h1>
            <p className="truncate text-xs text-slate-500">{subtitle}</p>
          </div>
          <button type="button" className="btn-ghost px-2" aria-label={t("খুঁজুন")} aria-pressed={searching} onClick={() => { setSearching((v) => !v); setTimeout(() => searchRef.current?.focus(), 0); }} id="ledger-search-toggle">🔍</button>
          <button type="button" className="btn-ghost px-2" aria-label={t("ফিল্টার")} aria-expanded={filterOpen} onClick={() => setFilterOpen((v) => !v)}>⚲</button>
        </div>
        {searching && (
          <input
            ref={searchRef}
            id="ledger-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("ভাউচার নং, এন্ট্রিদাতা বা বিবরণ দিয়ে খুঁজুন…")}
            className="input w-full"
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {/* date range */}
          <div className="relative">
            <button type="button" id="ledger-range" className="btn-secondary tabular-nums" aria-expanded={rangeOpen} onClick={() => setRangeOpen((v) => !v)}>
              📅 {fromText} – {toText}
            </button>
            {rangeOpen && (
              <div className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-rule bg-white p-3 shadow-lg" role="dialog" aria-label={t("তারিখের সীমা")}>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs"><span className="label">{t("শুরু")}</span><input type="date" id="ledger-from" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="input" /></label>
                  <label className="block text-xs"><span className="label">{t("শেষ")}</span><input type="date" id="ledger-to" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="input" /></label>
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-xs">
                  <button type="button" className="btn-ghost px-2 py-1" onClick={() => applyRange(`${today.slice(0, 8)}01`, today)}>{t("এই মাস")}</button>
                  <button type="button" className="btn-ghost px-2 py-1" onClick={() => applyRange(booksFrom, today)}>{t("সব")}</button>
                </div>
                <button type="button" id="ledger-range-apply" className="btn-primary mt-2 w-full" onClick={() => applyRange(range.from, range.to)}>{t("দেখুন")}</button>
              </div>
            )}
          </div>
          <button type="button" id="ledger-details" className={details ? "btn-primary" : "btn-secondary"} aria-pressed={details} onClick={() => setDetails((v) => !v)}>
            {details ? "☑" : "☐"} {t("বিস্তারিত দেখান")}
          </button>
          {/* type filter */}
          <div className="relative">
            <button type="button" id="ledger-filter" className={hidden.size ? "btn-primary" : "btn-secondary"} aria-expanded={filterOpen} onClick={() => setFilterOpen((v) => !v)}>
              ⚲ {t("ফিল্টার")}{hidden.size ? ` (${toBnDigits(types.length - hidden.size)}/${toBnDigits(types.length)})` : ""} ▾
            </button>
            {filterOpen && (
              <div className="absolute left-0 z-30 mt-1 w-56 rounded-lg border border-rule bg-white p-2 shadow-lg" id="ledger-filter-menu">
                {types.map(([type, label]) => (
                  <label key={type} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                    <input type="checkbox" checked={!hidden.has(type)} onChange={(e) => setHidden((h) => { const n = new Set(h); if (e.target.checked) n.delete(type); else n.add(type); return n; })} />
                    <span className={`h-2.5 w-2.5 rounded-sm ${BADGE[type] ?? "bg-teal-600"}`} aria-hidden /> {t(label)}
                  </label>
                ))}
                {hidden.size > 0 && <button type="button" className="btn-ghost mt-1 w-full py-1 text-xs" onClick={() => setHidden(new Set())}>{t("সব দেখান")}</button>}
              </div>
            )}
          </div>
          <span className="ml-auto flex flex-wrap gap-2">
            {canPrint && <button type="button" id="ledger-print" className="btn-secondary" onClick={() => window.print()}>🖨 {t("প্রিন্ট")}</button>}
            {canExport && <a href={`${exportHref}${exportHref.includes("?") ? "&" : "?"}format=xlsx`} className="btn-secondary" id="ledger-xlsx">⬇ Excel</a>}
            {canExport && <a href={exportHref} className="btn-secondary" id="ledger-csv">⬇ CSV</a>}
            <button type="button" id="ledger-share" className="btn-secondary" onClick={share} aria-label={t("শেয়ার")}>⤴ {t("শেয়ার")}</button>
          </span>
        </div>
      </div>

      {printHeader}

      <section className="panel print-area overflow-hidden">
        {/* ── desktop and paper: the ruled table */}
        <table className="ledger-table print-grid hidden w-full table-fixed border-collapse text-sm sm:table print:table print:text-[10px]" id="ledger-table">
          <colgroup>
            <col className="w-40 print:w-[24mm]" />
            <col />
            <col className="w-32 print:w-[24mm]" />
            <col className="w-32 print:w-[24mm]" />
            <col className="w-40 print:w-[34mm]" />
          </colgroup>
          <thead>
            <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
              <th className="border-b border-slate-300 px-3 py-2">{t("তারিখ")}</th>
              <th className="border-b border-slate-300 px-3 py-2">{t("বিবরণ")}</th>
              <th className="border-b border-slate-300 px-3 py-2 text-right">{CR}</th>
              <th className="border-b border-slate-300 px-3 py-2 text-right">{DR}</th>
              <th className="border-b border-slate-300 px-3 py-2 text-right">{t("ব্যালেন্স")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                className={`align-top ${r.voucherId ? "cursor-pointer hover:bg-slate-50" : "bg-slate-50/60"}`}
                onClick={() => go(r)}
                data-voucher={r.voucherNo ?? undefined}
              >
                <td className="border-b border-slate-200 px-3 py-2">
                  <span className="flex items-center gap-2 whitespace-nowrap print:flex-col print:items-start print:gap-0.5">{badge(r)}<span className="text-ink-800">{r.date}</span></span>
                </td>
                <td className="break-words border-b border-slate-200 px-3 py-2">{describe(r)}</td>
                <td className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-right tabular-nums text-emerald-700 print:text-black">{r.credit ? money(r.credit) : ""}</td>
                <td className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-right tabular-nums text-red-700 print:text-black">{r.debit ? money(r.debit) : ""}</td>
                <td className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-right font-medium tabular-nums">{drcr(r.balance)}</td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-slate-500">{t("কোনো লেনদেন পাওয়া যায়নি")}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-slate-50 font-semibold">
              <td className="border-t-2 border-slate-400 px-3 py-2">
                <span className="inline-flex items-center gap-1 text-sm print:text-[10px]" id="ledger-count"><span className="rounded bg-ink-800 px-1.5 py-0.5 text-xs text-white tabular-nums print:bg-transparent print:text-black">[{toBnDigits(entries.length)}]</span> {t("মোট")}</span>
              </td>
              <td className="border-t-2 border-slate-400 px-3 py-2 text-xs font-normal text-slate-500">{filtered ? t("ফিল্টার করা লাইনের যোগফল") : ""}</td>
              <td className="whitespace-nowrap border-t-2 border-slate-400 px-3 py-2 text-right tabular-nums" id="ledger-total-credit">{money(totalCredit)}</td>
              <td className="whitespace-nowrap border-t-2 border-slate-400 px-3 py-2 text-right tabular-nums" id="ledger-total-debit">{money(totalDebit)}</td>
              <td className="border-t-2 border-slate-400 px-3 py-2 text-right"><Net id="ledger-net" closing={closing} drcr={drcr} /></td>
            </tr>
          </tfoot>
        </table>

        {/* ── phones: the same lines as cards */}
        <ul className="divide-y divide-slate-200 sm:hidden print:hidden" id="ledger-cards">
          {visible.map((r) => (
            <li key={r.id} className={`px-3 py-2.5 ${r.voucherId ? "active:bg-slate-50" : "bg-slate-50/60"}`} onClick={() => go(r)}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs">{badge(r)}<span>{r.date}</span></span>
                <span className="text-right text-sm font-semibold tabular-nums">
                  {r.credit ? <span className="text-emerald-700">+{money(r.credit)}</span> : r.debit ? <span className="text-red-700">−{money(r.debit)}</span> : null}
                </span>
              </div>
              <div className="mt-1 text-sm">{describe(r)}</div>
              <div className="mt-0.5 text-right text-xs text-slate-500">{t("ব্যালেন্স")}: <span className="font-medium tabular-nums text-ink-800">{drcr(r.balance)}</span></div>
            </li>
          ))}
          <li className="space-y-1 bg-slate-50 px-3 py-3 text-sm">
            <div className="flex justify-between"><span>[{toBnDigits(entries.length)}] {t("মোট")}</span></div>
            <div className="flex justify-between"><span>{CR}</span><span className="tabular-nums">{money(totalCredit)}</span></div>
            <div className="flex justify-between"><span>{DR}</span><span className="tabular-nums">{money(totalDebit)}</span></div>
            <div className="flex justify-end"><Net closing={closing} drcr={drcr} /></div>
          </li>
        </ul>
      </section>
      <p className="no-print mt-2 text-xs text-slate-500">{t("প্রারম্ভিক")}: {drcr(opening)} · {t("সারিতে ক্লিক করলে ভাউচার খুলবে")}</p>
    </div>
  );
}

/** Net at the end of the period: Dr → পাওনা (green), Cr → দেনা (red). */
function Net({ id, closing, drcr }: { id?: string; closing: number; drcr: (n: number) => string }) {
  const t = useT();
  const zero = Math.abs(closing) < 0.005;
  const cls = zero ? "bg-slate-100 text-slate-700" : closing > 0 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-red-50 text-red-700 ring-red-200";
  return (
    <span id={id} className={`inline-flex flex-wrap items-center justify-end gap-x-1.5 whitespace-nowrap rounded px-2 py-1 text-sm font-bold ring-1 ring-inset tabular-nums print:whitespace-normal print:px-0 print:text-[10px] print:ring-0 ${cls}`}>
      {zero ? t("সমান") : closing > 0 ? t("পাওনা") : t("দেনা")} {drcr(closing)}
    </span>
  );
}

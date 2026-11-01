import Link from "next/link";
import { formatDate, formatDrCr, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import type { Cell, CellFormat, ReportResult } from "@/server/reports/types";
import { Badge, EmptyState } from "./ui";
import { getT } from "@/server/i18n";

export function formatCell(value: Cell, format: CellFormat | undefined, currency: string): string {
  if (value === null || value === undefined || value === "") return "";
  switch (format) {
    case "money":
      return formatMoney(value as number, currency);
    case "qty":
      return typeof value === "number" ? formatQty(value) : String(value);
    case "date":
      return formatDate(value as Date);
    case "drcr":
      return formatDrCr(value as number, currency);
    default:
      return String(value);
  }
}

const ROW_CLASS = { normal: "", detail: "text-slate-600", group: "row-group", subtotal: "row-subtotal", total: "row-total" };

const BADGE_COLORS: Record<string, string> = {
  OPENING: "bg-slate-500 text-white",
  PURCHASE: "bg-indigo-700 text-white",
  PURCHASE_RETURN: "bg-indigo-500 text-white",
  JOURNAL: "bg-pink-700 text-white",
  PAYMENT: "bg-purple-700 text-white",
  SALES: "bg-sky-600 text-white",
  SALES_RETURN: "bg-sky-800 text-white",
  RECEIPT: "bg-amber-600 text-white",
  STOCK_JOURNAL: "bg-teal-700 text-white",
  PRODUCTION: "bg-teal-600 text-white",
  DEPOT_DELIVERY: "bg-blue-700 text-white",
};

function getBadgeClass(rawType: string, typeName: string): string {
  const upper = rawType.toUpperCase();
  if (BADGE_COLORS[upper]) return BADGE_COLORS[upper];
  if (upper.includes("PAY") || typeName.includes("পেমেন্ট") || typeName.toLowerCase().includes("pay")) return "bg-purple-700 text-white";
  if (upper.includes("PURCH") || typeName.includes("ক্রয়") || typeName.toLowerCase().includes("purch")) return "bg-indigo-700 text-white";
  if (upper.includes("SALE") || typeName.includes("বিক্রয়") || typeName.toLowerCase().includes("sale")) return "bg-sky-600 text-white";
  if (upper.includes("REC") || typeName.includes("রিসিপ্ট") || typeName.includes("আদায়") || typeName.toLowerCase().includes("rec")) return "bg-amber-600 text-white";
  if (upper.includes("JOURN") || typeName.includes("জার্নাল") || typeName.toLowerCase().includes("journ")) return "bg-pink-700 text-white";
  if (upper.includes("OPEN") || typeName.includes("প্রারম্ভিক") || typeName.toLowerCase().includes("open")) return "bg-slate-500 text-white";
  return "bg-teal-600 text-white";
}

import { LedgerTableInteractive } from "./ledger-table-interactive";

export async function ReportTable({
  report,
  currency,
  canVerify,
  currentUserName,
}: {
  report: ReportResult;
  currency: string;
  canVerify?: boolean;
  currentUserName?: string;
}) {
  const t = await getT();
  if (!report || !report.rows || report.rows.length === 0) return <EmptyState message={report?.emptyMessage ? t(report.emptyMessage) : undefined} />;

  const isLedger = Boolean(
    report.isLedger ||
    ((report.columns ?? []).some((c) => c.key === "balance" && c.format === "drcr") &&
     (report.columns ?? []).some((c) => c.key === "voucher"))
  );

  if (isLedger) {
    return <LedgerTableInteractive report={report} currency={currency} canVerify={canVerify} currentUserName={currentUserName} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            {report.columns.map((c) => (
              <th key={c.key} className={c.format && c.format !== "text" && c.format !== "date" ? "num" : ""}>{t(c.label)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r, i) => (
            <tr key={i} className={ROW_CLASS[r.kind ?? "normal"]}>
              {report.columns.map((c, ci) => {
                const raw = r.cells[c.key];
                const text = formatCell(raw, c.format, currency);
                const numeric = c.format && c.format !== "text" && c.format !== "date";
                const tone = c.format === "drcr" && typeof raw === "number" ? (raw > 0 ? "dr" : raw < 0 ? "cr" : "") : c.format === "money" && typeof raw === "number" && raw < 0 ? "cr" : "";
                const firstText = ci === report.columns.findIndex((x) => !x.format || x.format === "text");
                return (
                  <td key={c.key} className={`${numeric ? "num" : ""} ${c.format === "date" ? "whitespace-nowrap" : ""} ${tone}`} style={firstText && r.indent ? { paddingLeft: `${0.75 + r.indent * 1.1}rem` } : undefined}>
                    {firstText && r.href && text ? <Link prefetch={false} href={r.href} className="hover:text-brand-700 hover:underline">{text}</Link> : text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function ReportSummary({ report }: { report: ReportResult }) {
  if (!report.summary?.length) return null;
  const t = await getT();
  const tones = { green: "text-brand-700", red: "text-credit", blue: "text-debit", slate: "text-ink-900" };
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-rule border-b border-rule sm:grid-cols-4 sm:divide-y-0">
      {report.summary.map((s) => (
        <div key={s.label} className="px-4 py-2.5">
          <p className="text-[11px] text-slate-500">{t(s.label)}</p>
          <p className={`text-sm font-bold tabular-nums ${tones[s.tone ?? "slate"]}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

export async function ReportNotes({ report }: { report: ReportResult }) {
  if (!report.notes?.length) return null;
  const t = await getT();
  return (
    <div className="space-y-1 border-t border-rule px-4 py-2 text-xs text-slate-500">
      {report.notes.map((n) => <p key={n}><Badge>{t("নোট")}</Badge> {t(n)}</p>)}
    </div>
  );
}

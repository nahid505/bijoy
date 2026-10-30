// Dashboard building blocks: the centred header (title, company, English and Bangla date) and the cash book widget. Every figure falls back to 0 / an empty list.
import Link from "next/link";
import { formatDate, formatMoney, toDateInput } from "@/lib/format";
import { MONTHS_EN } from "@/lib/i18n";
import { can, type AppContext } from "@/server/auth";
import { getT } from "@/server/i18n";
import { dailyCash } from "@/server/reports/daily-cash";

const BN_WEEKDAYS = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"];

/** "28 October 2026" and "২৮ অক্টোবর ২০২৬, বুধবার" for a YYYY-MM-DD day. */
export function dashboardDates(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
  return { en: `${d} ${MONTHS_EN[(m || 1) - 1]} ${y}`, bn: `${formatDate(day)}, ${BN_WEEKDAYS[weekday]}` };
}

export async function DashboardHeader({ ctx, note }: { ctx: AppContext; note?: string }) {
  const t = await getT();
  const dates = dashboardDates(toDateInput());
  return (
    <header className="mb-5 text-center" id="dashboard-header">
      <h1 className="text-2xl font-bold text-ink-900">{t("ড্যাশবোর্ড")}</h1>
      <p className="mt-0.5 text-base font-semibold text-brand-700" data-keep-lang>{ctx.business?.name ?? ""}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs font-medium">
        <span id="date-en" className="rounded-full bg-sky-50 px-3 py-1 text-sky-800 ring-1 ring-sky-200" data-keep-lang>{dates.en}</span>
        <span id="date-bn" className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800 ring-1 ring-emerald-200" data-keep-lang>{dates.bn}</span>
      </div>
      {note && <p className="mt-1.5 text-xs text-slate-500">{note}</p>}
    </header>
  );
}

/** Today's cash book: brought forward, cash received, cash paid and cash in hand (the daily cash book's figures). */
export async function CashBookWidget({ ctx }: { ctx: AppContext }) {
  if (!can(ctx, "accounts:view")) return null;
  const t = await getT();
  const cur = ctx.business.currencySymbol;
  const c = await dailyCash(ctx.business.id, {}).catch(() => null);
  const row = (label: string, value: number, cls = "", id?: string) => (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <span className="text-sm text-slate-600">{label}</span>
      <span id={id} className={`text-base font-semibold tabular-nums ${cls}`}>{formatMoney(value ?? 0, cur)}</span>
    </div>
  );
  return (
    <section className="panel flex h-full flex-col" id="cash-book-widget" aria-labelledby="cash-book-heading">
      <div className="panel-head">
        <h2 id="cash-book-heading" className="panel-title">📒 {t("ক্যাশ বুক")}</h2>
        <Link prefetch={false} href="/reports/daily-cash" className="text-xs font-medium text-brand-700 hover:underline">{t("ডেইলী জমা-খরচ হিসাব")}</Link>
      </div>
      <div className="flex-1 divide-y divide-rule">
        {row(t("পূর্বের জের"), c?.opening ?? 0, "text-slate-700", "cb-opening")}
        {row(t("আজকের মোট নগদ জমা"), c?.todayReceipts ?? 0, "text-debit", "cb-in")}
        {row(t("আজকের মোট নগদ খরচ"), c?.totalPayments ?? 0, "text-credit", "cb-out")}
      </div>
      <div className="flex items-baseline justify-between gap-3 rounded-b-lg border-t-2 border-brand-600 bg-brand-50 px-4 py-3">
        <span className="text-sm font-semibold text-ink-900">{t("অবশিষ্ট ক্যাশ ইন হ্যান্ড")}</span>
        <span id="cb-closing" className={`text-xl font-bold tabular-nums ${(c?.closing ?? 0) < 0 ? "text-credit" : "text-brand-700"}`}>{formatMoney(c?.closing ?? 0, cur)}</span>
      </div>
    </section>
  );
}

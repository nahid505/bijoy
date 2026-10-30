// Depot dashboard (business type DEPOT): quick actions and the four depot cards (2 × 2) beside an optional side box
// (the cash book widget).
import Link from "next/link";
import { DEPOT_ACCESS, DEPOT_CASH_NAME } from "@/lib/depot";
import { formatMoney, formatQty, toBnDigits, toDateInput } from "@/lib/format";
import { can, type AppContext } from "@/server/auth";
import { depotDashboard } from "@/server/services/depot";
import { depotCashSummary } from "@/server/services/depot-cash";
import { allowedAccounts } from "@/server/party-scope";
import { getT } from "@/server/i18n";

export interface DashCard {
  label: string;
  value: string;
  hint?: string;
  href: string;
  /** links only where this user may go */
  ok: boolean;
  tone: string;
  icon: string;
}

/** Figure cards in a 2 × 2 grid (a fifth card spans the row). */
export function CardGrid({ cards, id }: { cards: DashCard[]; id?: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" id={id}>
      {cards.map((c, i) => {
        const wide = cards.length % 2 === 1 && i === cards.length - 1;
        const body = (
          <>
            <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><span aria-hidden>{c.icon}</span>{c.label}</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${c.tone}`}>{c.value}</p>
            {c.hint && <p className="mt-0.5 text-xs text-slate-400">{c.hint}</p>}
          </>
        );
        const cls = `panel dash-card block px-4 py-3 ${wide ? "sm:col-span-2" : ""}`;
        return c.ok ? (
          <Link prefetch={false} key={c.label} href={c.href} className={`${cls} hover:bg-brand-50/50`}>{body}</Link>
        ) : (
          <div key={c.label} className={cls}>{body}</div>
        );
      })}
    </div>
  );
}

export async function DepotPanel({ ctx, side }: { ctx: AppContext; side?: React.ReactNode }) {
  const cur = ctx.business.currencySymbol;
  const t = await getT();
  const [d, box] = await Promise.all([depotDashboard(ctx.business.id, toDateInput()), depotCashSummary(ctx.business.id)]);
  const heads = allowedAccounts(ctx);
  // the depot cash box: for whoever spends from it or reads its cash book (and, if restricted, has it assigned)
  const showBox = !!box && (can(ctx, DEPOT_ACCESS.expense) || can(ctx, DEPOT_ACCESS.cashbook)) && (!heads || heads.includes(box.accountId));
  const today = d?.today;
  const quick = [
    { href: "/depot/stock-in/new", label: t("নতুন স্টক ইন (কোম্পানি থেকে প্রাপ্তি)"), icon: "📥", ok: can(ctx, DEPOT_ACCESS.stockIn) },
    { href: "/depot/deliveries/new", label: t("ডেলিভারি চালান তৈরি"), icon: "🚚", ok: can(ctx, DEPOT_ACCESS.deliveryCreate), primary: true },
    { href: "/depot/collections/new", label: t("মার্কেট কালেকশন"), icon: "💵", ok: can(ctx, DEPOT_ACCESS.collection) },
    { href: "/depot/commission", label: t("কোম্পানি কমিশন হিসাব"), icon: "🧮", ok: can(ctx, DEPOT_ACCESS.commission) },
    { href: "/depot/expenses/new", label: t("ডিপো খরচ এন্ট্রি"), icon: "🧾", ok: can(ctx, DEPOT_ACCESS.expense) },
  ].filter((q) => q.ok);
  const cards: DashCard[] = [
    { icon: "🚚", label: t("আজকের ডেলিভারি"), value: t("{n} টি চালান", { n: toBnDigits(today?.count ?? 0) }), hint: t("ডিও রিলিজ {do} · মার্কেট সেলস {market} · মোট পরিমাণ {qty}", { do: toBnDigits(today?.doCount ?? 0), market: toBnDigits(today?.marketCount ?? 0), qty: formatQty(today?.quantity ?? 0) }), href: "/depot/deliveries", ok: can(ctx, DEPOT_ACCESS.view), tone: "text-ink-900" },
    { icon: "🧮", label: t("কোম্পানির কাছে মোট প্রাপ্য কমিশন"), value: formatMoney(d?.commissionReceivable ?? 0, cur), hint: t("আজ অর্জিত {amount}", { amount: formatMoney(today?.commission ?? 0, cur) }), href: "/depot/commission", ok: can(ctx, DEPOT_ACCESS.commission), tone: "text-debit" },
    ...(showBox ? [{ icon: "💰", label: t("{name} — বর্তমান ব্যালেন্স", { name: t(DEPOT_CASH_NAME) }), value: formatMoney(box?.balance ?? 0, cur), hint: t("জমা, খরচ ও ফান্ড স্থানান্তরের পর"), href: "/reports/depot-cash-book", ok: can(ctx, DEPOT_ACCESS.cashbook), tone: (box?.balance ?? 0) < 0 ? "text-credit" : "text-debit" }] : []),
    { icon: "📦", label: t("বর্তমান ডিপো স্টক"), value: formatMoney(d?.stockValue ?? 0, cur), hint: t("{n} টি আইটেম — গড় ক্রয়মূল্যে", { n: toBnDigits(d?.stockItems ?? 0) }), href: "/depot/products", ok: can(ctx, DEPOT_ACCESS.productsView), tone: "text-brand-700" },
  ];
  return (
    <section className="mb-4 space-y-3" aria-labelledby="depot-heading">
      <h2 id="depot-heading" className="flex items-center gap-2 text-base font-bold text-ink-900">
        <span aria-hidden>🏬</span> {t("ডিপো ব্যবস্থাপনা")}
      </h2>
      {quick.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5" aria-label={t("ডিপো দ্রুত কাজ")}>
          {quick.map((q) => (
            <Link prefetch={false} key={q.href} href={q.href} className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-sm font-semibold transition ${q.primary ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700" : "border-rule bg-white text-ink-800 hover:border-brand-500 hover:bg-brand-50"}`}>
              <span aria-hidden className="text-lg">{q.icon}</span>
              {q.label}
            </Link>
          ))}
        </div>
      )}
      <div className={`grid gap-4 ${side ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : ""}`} id="depot-grid">
        <CardGrid cards={cards} id="depot-cards" />
        {side}
      </div>
    </section>
  );
}

// Depot dashboard (business type DEPOT): quick actions and the four depot figures.
import Link from "next/link";
import { DEPOT_ACCESS, DEPOT_CASH_NAME } from "@/lib/depot";
import { formatMoney, formatQty, toBnDigits, toDateInput } from "@/lib/format";
import { can, type AppContext } from "@/server/auth";
import { depotDashboard } from "@/server/services/depot";
import { depotCashSummary } from "@/server/services/depot-cash";
import { allowedAccounts } from "@/server/party-scope";

export async function DepotPanel({ ctx }: { ctx: AppContext }) {
  const cur = ctx.business.currencySymbol;
  const [d, box] = await Promise.all([depotDashboard(ctx.business.id, toDateInput()), depotCashSummary(ctx.business.id)]);
  const heads = allowedAccounts(ctx);
  // the depot cash box: for whoever spends from it or reads its cash book (and, if restricted, has it assigned)
  const showBox = box && (can(ctx, DEPOT_ACCESS.expense) || can(ctx, DEPOT_ACCESS.cashbook)) && (!heads || heads.includes(box.accountId));
  const quick = [
    { href: "/depot/stock-in/new", label: "নতুন স্টক ইন (কোম্পানি থেকে প্রাপ্তি)", icon: "📥", ok: can(ctx, DEPOT_ACCESS.stockIn) },
    { href: "/depot/deliveries/new", label: "ডেলিভারি চালান তৈরি", icon: "🚚", ok: can(ctx, DEPOT_ACCESS.deliveryCreate), primary: true },
    { href: "/depot/collections/new", label: "মার্কেট কালেকশন", icon: "💵", ok: can(ctx, DEPOT_ACCESS.collection) },
    { href: "/depot/commission", label: "কোম্পানি কমিশন হিসাব", icon: "🧮", ok: can(ctx, DEPOT_ACCESS.commission) },
    { href: "/depot/expenses/new", label: "ডিপো খরচ এন্ট্রি", icon: "🧾", ok: can(ctx, DEPOT_ACCESS.expense) },
  ].filter((q) => q.ok);
  const cards = [
    { label: "আজকের ডেলিভারি", value: `${toBnDigits(d.today.count)} টি চালান`, hint: `ডিও রিলিজ ${toBnDigits(d.today.doCount)} · মার্কেট সেলস ${toBnDigits(d.today.marketCount)} · মোট পরিমাণ ${formatQty(d.today.quantity)}`, href: "/depot/deliveries", ok: can(ctx, DEPOT_ACCESS.view), tone: "text-ink-900" },
    { label: "কোম্পানির কাছে মোট প্রাপ্য কমিশন", value: formatMoney(d.commissionReceivable, cur), hint: `আজ অর্জিত ${formatMoney(d.today.commission, cur)}`, href: "/depot/commission", ok: can(ctx, DEPOT_ACCESS.commission), tone: "text-debit" },
    { label: "ডিলারদের মোট মার্কেট বাকি", value: formatMoney(d.marketDue, cur), hint: `${toBnDigits(d.dealersWithDue)} জন ডিলারের কাছে`, href: "/reports/depot-market-dues", ok: can(ctx, DEPOT_ACCESS.reports), tone: "text-credit" },
    { label: "বর্তমান ডিপো স্টক মূল্য", value: formatMoney(d.stockValue, cur), hint: "গড় ক্রয়মূল্যে", href: "/products", ok: can(ctx, "inventory:view"), tone: "text-brand-700" },
    ...(showBox ? [{ label: `${DEPOT_CASH_NAME} — বর্তমান ব্যালেন্স`, value: formatMoney(box.balance, cur), hint: "জমা, খরচ ও ফান্ড স্থানান্তরের পর", href: "/reports/depot-cash-book", ok: can(ctx, DEPOT_ACCESS.cashbook), tone: box.balance < 0 ? "text-credit" : "text-debit" }] : []),
  ];
  return (
    <section className="mb-4 space-y-3" aria-labelledby="depot-heading">
      <h2 id="depot-heading" className="flex items-center gap-2 text-base font-bold text-ink-900">
        <span aria-hidden>🏬</span> ডিপো ব্যবস্থাপনা
      </h2>
      {quick.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="ডিপো দ্রুত কাজ">
          {quick.map((q) => (
            <Link prefetch={false} key={q.href} href={q.href} className={`flex items-center gap-2 rounded-lg border px-3 py-3 text-sm font-semibold transition ${q.primary ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700" : "border-rule bg-white text-ink-800 hover:border-brand-500 hover:bg-brand-50"}`}>
              <span aria-hidden className="text-lg">{q.icon}</span>
              {q.label}
            </Link>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" id="depot-cards">
        {cards.map((c) => {
          const body = (
            <>
              <p className="text-xs font-medium text-slate-500">{c.label}</p>
              <p className={`mt-1 text-xl font-bold tabular-nums ${c.tone}`}>{c.value}</p>
              <p className="mt-0.5 text-xs text-slate-400">{c.hint}</p>
            </>
          );
          // a card links only where this user may go
          return c.ok ? (
            <Link prefetch={false} key={c.label} href={c.href} className="panel block px-4 py-3 hover:bg-brand-50/50">{body}</Link>
          ) : (
            <div key={c.label} className="panel px-4 py-3">{body}</div>
          );
        })}
      </div>
    </section>
  );
}

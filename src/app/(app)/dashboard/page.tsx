import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { num } from "@/lib/db";
import { formatDate, formatMoney, formatQty, MONTH_NAMES, toBnDigits } from "@/lib/format";
import { GroupedBars } from "@/components/month-bars";
import { Badge, EmptyState } from "@/components/ui";
import { can, requireContext, type AppContext } from "@/server/auth";
import { isRestricted } from "@/server/party-scope";
import { AssignedDashboard } from "./assigned-panel";
import { getT } from "@/server/i18n";
import { dashboardData } from "@/server/services/dashboard";
import { ensureDailyChecks } from "@/server/services/notifications";
import { ExpiryBadge } from "@/components/expiry-badge";
import { AccountSummary, LatestNotifications, RecentPurchases } from "./account-panels";
import { FEATURES, type FeatureDef } from "@/lib/features";
import { isDepot } from "@/lib/depot";
import { DepotPanel } from "./depot-panel";

export const metadata: Metadata = { title: "ড্যাশবোর্ড" };

// Validated (dataviz checker) CVD-safe pair: sales = green, collection = blue.
const C = { a: "#0e8a5d", b: "#1d4f91" };

function Figure({ label, value, tone = "", hint, href }: { label: string; value: string; tone?: string; hint?: string; href?: string }) {
  const body = (
    <>
      <span className="figure-label">{label}</span>
      <span className={`figure-value ${tone}`}>{value}</span>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </>
  );
  return href ? <Link prefetch={false} href={href} className="figure hover:bg-brand-50/60">{body}</Link> : <div className="figure">{body}</div>;
}

function Panel({ title, href, linkLabel, children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        {href && <Link prefetch={false} href={href} className="text-xs font-medium text-brand-700 hover:underline">{linkLabel}</Link>}
      </div>
      {children}
    </section>
  );
}

function quickActions(ctx: AppContext) {
  return [
    { href: "/pos", label: "নতুন বিক্রয়", icon: "🧾", ok: can(ctx, "sales:create"), primary: true },
    { href: "/vouchers/purchase/new", label: "নতুন ক্রয়", icon: "📦", ok: can(ctx, "purchases:create") },
    { href: "/vouchers/receipt/new", label: "টাকা আদায়", icon: "💵", ok: can(ctx, "vouchers:create") },
    { href: "/vouchers/payment/new", label: "সরবরাহকারীকে পরিশোধ", icon: "💸", ok: can(ctx, "vouchers:create") },
    { href: "/customers/new", label: "কাস্টমার যোগ", icon: "👤", ok: can(ctx, "customers:manage") },
    { href: "/products/new", label: "পণ্য যোগ", icon: "🏷", ok: can(ctx, "inventory:manage") },
    { href: "/vouchers/payment/new?mode=expense", label: "খরচ", icon: "🧮", ok: can(ctx, "vouchers:create") },
  ].filter((q) => q.ok);
}

function QuickActions({ quick, label }: { quick: ReturnType<typeof quickActions>; label: string }) {
  if (quick.length === 0) return null;
  return (
    <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" aria-label={label}>
      {quick.map((q) => (
        <Link prefetch={false}
          key={q.href}
          href={q.href}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${q.primary ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700" : "border-rule bg-white text-ink-800 hover:border-brand-500 hover:bg-brand-50"}`}
        >
          <span aria-hidden className="text-lg">{q.icon}</span>
          {q.label}
        </Link>
      ))}
    </section>
  );
}

export default async function DashboardPage() {
  const ctx = await requireContext();
  if (!can(ctx, "dashboard:view")) {
    // depot-only role: the depot dashboard alone — no sales, profit, ledger or cash figures
    if (isDepot(ctx.business.businessType) && can(ctx, "depot:view")) {
      return (
        <>
          <div className="mb-4">
            <h1 className="text-xl font-bold text-ink-900">ডিপো ড্যাশবোর্ড</h1>
            <p className="text-sm text-slate-500">ডিপো ব্যবস্থাপনার সারসংক্ষেপ — {formatDate(new Date())}</p>
          </div>
          <DepotPanel ctx={ctx} />
        </>
      );
    }
    redirect("/forbidden");
  }
  // trial / subscription over: whoever handles billing chooses first — renew, or continue on the free plan
  if (ctx.subscription?.status === "EXPIRED" && can(ctx, "billing:manage")) redirect("/billing?expired=1");
  const t = await getT();
  // assigned-only role: no business-wide figures — their own customers / suppliers only
  if (isRestricted(ctx)) {
    return (
      <>
        <div className="mb-4">
          <h1 className="text-xl font-bold text-ink-900">{t("ড্যাশবোর্ড")}</h1>
          <p className="text-sm text-slate-500">আমার কাস্টমার ও সরবরাহকারী — {formatDate(new Date())}</p>
        </div>
        <QuickActions quick={quickActions(ctx).map((q) => ({ ...q, label: t(q.label) }))} label={t("দ্রুত কাজ")} />
        <AssignedDashboard ctx={ctx} />
      </>
    );
  }
  const cur = ctx.business.currencySymbol;
  await ensureDailyChecks(ctx.business.id).catch(() => null); // daily alerts, if the scheduler has not run yet today
  const d = await dashboardData(ctx.business.id, ctx.business.fiscalYearStartMonth);
  const modules = (FEATURES as readonly FeatureDef[]).filter((m) => m.home && ctx.features.includes(m.key) && can(ctx, m.home.permission));
  const showExpiry = can(ctx, "inventory:view") && ctx.features.includes("PRODUCT_EXPIRY") && (d.expiry.cards.some((c) => c.batches > 0) || d.expiry.attention.length > 0);
  const f = d.figures;
  const depot = isDepot(ctx.business.businessType);

  const quick = quickActions(ctx);

  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-ink-900">{t("ড্যাশবোর্ড")}</h1>
        <p className="text-sm text-slate-500">{t("হিসাবের সারসংক্ষেপ")} — {formatDate(new Date())}</p>
      </div>

      <AccountSummary ctx={ctx} />

      {/* depot business: depot quick actions and figures replace the general quick actions */}
      {depot && <DepotPanel ctx={ctx} />}

      {!depot && quick.length > 0 && (
        <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" aria-label={t("দ্রুত কাজ")}>
          {quick.map((q) => (
            <Link prefetch={false}
              key={q.href}
              href={q.href}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${q.primary ? "border-brand-600 bg-brand-600 text-white hover:bg-brand-700" : "border-rule bg-white text-ink-800 hover:border-brand-500 hover:bg-brand-50"}`}
            >
              <span aria-hidden className="text-lg">{q.icon}</span>
              {t(q.label)}
            </Link>
          ))}
        </section>
      )}

      {/* Active optional modules (Feature Management) — only those this user may open */}
      {modules.length > 0 && (
        <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm" aria-label={t("চালু মডিউল")}>
          <span className="text-xs font-medium text-slate-500">{t("চালু মডিউল")}:</span>
          {modules.map((m) => (
            <Link key={m.key} prefetch={false} href={m.home!.href} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-ink-800 ring-1 ring-rule hover:bg-brand-50">
              <span aria-hidden>{m.icon}</span>{m.nameBn}
            </Link>
          ))}
        </nav>
      )}

      {/* Today */}
      <section className="panel mb-4">
        <div className="panel-head"><h2 className="panel-title">আজকের লেনদেন</h2><span className="text-xs text-slate-500">{toBnDigits(f.salesCount)} টি বিক্রয়</span></div>
        <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-5 sm:divide-y-0">
          <Figure label={t("আজকের বিক্রয়")} value={formatMoney(f.todaySales, cur)} tone="text-brand-700" href="/vouchers/sales" />
          <Figure label={t("আজকের ক্রয়")} value={formatMoney(f.todayPurchase, cur)} href="/vouchers/purchase" />
          <Figure label={t("আজকের আদায়")} value={formatMoney(f.todayCollection, cur)} tone="text-debit" href="/reports/collection" />
          <Figure label={t("আজকের খরচ")} value={formatMoney(f.todayExpense, cur)} tone="text-credit" href="/expenses" />
          <Figure label={f.todayProfit >= 0 ? t("আজকের লাভ") : "আজকের ক্ষতি"} value={formatMoney(f.todayProfit, cur)} tone={f.todayProfit >= 0 ? "text-brand-700" : "text-credit"} href="/reports/daily-summary" />
        </div>
      </section>

      {/* Position */}
      <section className="panel mb-4">
        <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
          <Figure label={t("মোট পাওনা")} value={formatMoney(f.receivable, cur)} tone="text-debit" href="/dues/customers" />
          <Figure label={t("মেয়াদোত্তীর্ণ বকেয়া")} value={formatMoney(f.overdueTotal, cur)} tone={f.overdueTotal > 0 ? "text-credit" : ""} hint={`${toBnDigits(f.overdueCount)} জন কাস্টমার`} href="/dues/customers?type=overdue" />
          <Figure label={t("মোট দেনা")} value={formatMoney(f.payable, cur)} tone="text-credit" href="/dues/suppliers" />
          <Figure label={t("নগদ ব্যালেন্স")} value={formatMoney(f.cash, cur)} tone={f.cash < 0 ? "text-credit" : ""} href="/accounts/cash" />
          <Figure label={t("ব্যাংক ব্যালেন্স")} value={formatMoney(f.bank, cur)} href="/accounts/bank" />
          <Figure label={t("মজুদ মূল্য")} value={formatMoney(f.stockValue, cur)} hint={f.expiringBatches ? `${toBnDigits(f.expiringBatches)} টি ব্যাচের মেয়াদ শেষ হচ্ছে` : undefined} href="/reports/stock-valuation" />
        </div>
      </section>

      {showExpiry && (
        <section className="panel mb-4" aria-labelledby="expiry-heading">
          <div className="panel-head">
            <h2 id="expiry-heading" className="panel-title">{t("পণ্যের মেয়াদ")}</h2>
            <Link prefetch={false} href="/products/batches" className="text-xs font-medium text-brand-700 hover:underline">{t("সব ব্যাচ")}</Link>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-4 sm:divide-y-0">
            {d.expiry.cards.map((c) => (
              <Link prefetch={false} key={c.key} href={c.href} className={`figure hover:bg-brand-50/60 ${c.batches > 0 && c.tone === "red" ? "bg-red-50/60" : ""}`}>
                <span className="figure-label">{c.tone === "red" ? "🔴" : "🟠"} {t(c.label)}</span>
                <span className={`figure-value ${c.batches > 0 ? (c.tone === "red" ? "text-red-700" : "text-amber-700") : ""}`}>{toBnDigits(c.batches)} <span className="text-xs font-normal">টি ব্যাচ</span></span>
                <span className="text-[11px] text-slate-500">{formatQty(c.quantity)} একক · {formatMoney(c.value, cur)}</span>
              </Link>
            ))}
          </div>
          {d.expiry.attention.length > 0 && (
            <div className="overflow-x-auto border-t border-rule">
              <table className="table">
                <thead><tr><th>পণ্য</th><th>ব্যাচ</th><th>মেয়াদ</th><th>অবস্থা</th><th className="num">মজুদ</th></tr></thead>
                <tbody>
                  {d.expiry.attention.map((b) => (
                    <tr key={b.id}>
                      <td><Link prefetch={false} href={`/products/batches?product=${b.productId}`} className="hover:text-brand-700">{b.productName}</Link></td>
                      <td className="font-mono text-xs">{b.batchNo}</td>
                      <td className="whitespace-nowrap">{formatDate(b.expiryDate)}</td>
                      <td><ExpiryBadge status={b.status} /></td>
                      <td className="num">{formatQty(b.quantity)} {b.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <GroupedBars
          title={t("গত ৩০ দিন — বিক্রয় ও আদায়")}
          points={d.days.map((x) => ({ key: x.key, label: toBnDigits(x.label), fullLabel: formatDate(x.key), a: x.a, b: x.b }))}
          labelA={t("বিক্রয়")}
          labelB={t("আদায়")}
          colorA={C.a}
          colorB={C.b}
          currency={cur}
        />
        <GroupedBars
          title={t("মাসিক বিক্রয় ও আদায় (চলতি অর্থবছর)")}
          points={d.months.map((x) => ({ key: x.key, label: MONTH_NAMES[x.month].slice(0, 3), fullLabel: MONTH_NAMES[x.month], a: x.a, b: x.b }))}
          labelA={t("বিক্রয়")}
          labelB={t("আদায়")}
          colorA={C.a}
          colorB={C.b}
          currency={cur}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Panel title={t("সাম্প্রতিক বিক্রয়")} href="/vouchers/sales" linkLabel={t("সব দেখুন")}>
          {d.recentSales.length === 0 ? <EmptyState message="এখনও কোনো বিক্রয় নেই" /> : (
            <table className="table">
              <tbody>
                {d.recentSales.map((v) => {
                  const due = num(v.amount) - num(v.paidAmount);
                  return (
                    <tr key={v.id}>
                      <td>
                        <Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-semibold text-brand-700 hover:underline">{v.voucherNo}</Link>
                        <span className="block text-xs text-slate-500">{formatDate(v.date)} · {v.partyAccount?.name ?? "নগদ কাস্টমার"}</span>
                      </td>
                      <td className="num">
                        {formatMoney(num(v.amount), cur)}
                        <span className="block">{due > 0 ? <Badge tone="amber">বাকি {formatMoney(due, cur)}</Badge> : <Badge tone="green">পরিশোধিত</Badge>}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>

        <RecentPurchases ctx={ctx} />

        <Panel title={t("সাম্প্রতিক পেমেন্ট")} href="/vouchers/receipt" linkLabel={t("সব দেখুন")}>
          {d.recentPayments.length === 0 ? <EmptyState message="এখনও কোনো পেমেন্ট নেই" /> : (
            <table className="table">
              <tbody>
                {d.recentPayments.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-semibold text-brand-700 hover:underline">{v.voucherNo}</Link>
                      <span className="block text-xs text-slate-500">{formatDate(v.date)} · {v.partyAccount?.name ?? v.narration ?? ""} · {v.cashAccount?.name}</span>
                    </td>
                    <td className={`num font-semibold ${v.type === "RECEIPT" ? "text-brand-700" : "text-credit"}`}>{v.type === "RECEIPT" ? "+" : "−"} {formatMoney(num(v.amount), cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title={t("মেয়াদোত্তীর্ণ বকেয়া")} href="/dues/customers?type=overdue" linkLabel={t("সব দেখুন")}>
          {d.overdue.length === 0 ? <EmptyState message="কোনো মেয়াদোত্তীর্ণ বকেয়া নেই ✅" /> : (
            <table className="table">
              <tbody>
                {d.overdue.map((c) => (
                  <tr key={c.accountId}>
                    <td>
                      <Link prefetch={false} href={`/customers/${c.partyId}?tab=dues`} className="font-medium hover:text-brand-700">{c.name}</Link>
                      <span className="block text-xs text-slate-500">{c.mobile ?? ""} · সবচেয়ে পুরনো {toBnDigits(Math.max(...c.openItems.map((o) => o.overdueDays)))} দিন পার</span>
                    </td>
                    <td className="num font-semibold text-credit">{formatMoney(c.overdue, cur)}<span className="block text-[11px] font-normal text-slate-500">মোট {formatMoney(c.balance, cur)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <LatestNotifications ctx={ctx} />

        <Panel title={t("কম মজুদের পণ্য")} href="/products?low=1" linkLabel={t("সব দেখুন")}>
          {d.lowStock.length === 0 ? <EmptyState message="সব পণ্যের পর্যাপ্ত মজুদ আছে" /> : (
            <table className="table">
              <tbody>
                {d.lowStock.map((p) => (
                  <tr key={p.id}>
                    <td><Link prefetch={false} href={`/products/${p.id}`} className="hover:text-brand-700">{p.name}</Link><span className="block text-xs text-slate-500">ন্যূনতম {formatQty(p.minStock)} {p.unit}</span></td>
                    <td className="num"><Badge tone={Number(p.stock) <= 0 ? "red" : "amber"}>{formatQty(p.stock)} {p.unit}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="নগদ ও ব্যাংক হিসাব" href="/accounts/cash" linkLabel="ক্যাশ বুক">
          <table className="table">
            <tbody>
              {d.cashBank.map((a) => (
                <tr key={a.id}>
                  <td><Link prefetch={false} href={`/accounts/${a.id}`} className="hover:text-brand-700">{a.name}</Link> <Badge tone={a.kind === "CASH" ? "green" : "blue"}>{a.kind === "CASH" ? "নগদ" : "ব্যাংক"}</Badge></td>
                  <td className={`num font-semibold ${a.balance < 0 ? "cr" : ""}`}>{formatMoney(a.balance, cur)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>মোট</td><td className="num">{formatMoney(f.cash + f.bank, cur)}</td></tr></tfoot>
          </table>
        </Panel>

        <Panel title="আজকের অন্যান্য হিসাব" href="/reports/daily-summary" linkLabel={t("দৈনিক সারসংক্ষেপ")}>
          <table className="table">
            <tbody>
              <tr><td>অন্যান্য আয়</td><td className="num">{formatMoney(f.todayIncome, cur)}</td></tr>
              <tr><td>পরিচালন খরচ</td><td className="num cr">{formatMoney(f.todayExpense, cur)}</td></tr>
              <tr><td>নিট বিক্রয়</td><td className="num">{formatMoney(f.todaySales, cur)}</td></tr>
              <tr><td>আদায়</td><td className="num dr">{formatMoney(f.todayCollection, cur)}</td></tr>
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

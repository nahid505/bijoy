import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireContext, type AppContext } from "@/server/auth";
import { isRestricted } from "@/server/party-scope";
import { AssignedDashboard } from "./assigned-panel";
import { getT } from "@/server/i18n";
import { ensureDailyChecks } from "@/server/services/notifications";
import { isDepot } from "@/lib/depot";
import { DepotPanel } from "./depot-panel";
import { CashBookWidget, DashboardHeader } from "./dashboard-parts";
import { riceMillHome } from "@/lib/rice-mill";
import { businessModules } from "@/lib/business-types";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("ড্যাশবোর্ড") };
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

/**
 * The dashboard: the centred header, then a depot business's action buttons and four depot cards beside the cash
 * book (a general business: its quick actions and the cash book).
 */
export default async function DashboardPage() {
  const ctx = await requireContext();
  const t = await getT();
  if (!can(ctx, "dashboard:view")) {
    // depot-only role: the depot dashboard alone — no sales, profit, ledger or cash figures
    if (isDepot(ctx.business.businessType) && can(ctx, "depot:view")) {
      return (
        <>
          <DashboardHeader ctx={ctx} note={`${t("ডিপো ড্যাশবোর্ড")} — ${t("ডিপো ব্যবস্থাপনার সারসংক্ষেপ")}`} />
          <DepotPanel ctx={ctx} />
        </>
      );
    }
    // rice-mill-only role (scale operator, mill supervisor…): its first rice-mill screen
    const mill = businessModules(ctx.business.businessTypes).has("RICE_MILL") ? riceMillHome((p) => can(ctx, p)) : null;
    redirect(mill ?? "/forbidden");
  }
  // trial / subscription over: whoever handles billing chooses first — renew, or continue on the free plan
  if (ctx.subscription?.status === "EXPIRED" && can(ctx, "billing:manage")) redirect("/billing?expired=1");
  const quick = quickActions(ctx).map((q) => ({ ...q, label: t(q.label) }));
  // assigned-only role: no business-wide figures — their own customers / suppliers only
  if (isRestricted(ctx)) {
    return (
      <>
        <DashboardHeader ctx={ctx} note={t("আমার কাস্টমার ও সরবরাহকারী")} />
        <QuickActions quick={quick} label={t("দ্রুত কাজ")} />
        <AssignedDashboard ctx={ctx} />
      </>
    );
  }
  await ensureDailyChecks(ctx.business.id).catch(() => null); // daily alerts (header bell), if the scheduler has not run yet today
  const depot = isDepot(ctx.business.businessType);
  const cashBook = can(ctx, "accounts:view") ? <CashBookWidget ctx={ctx} /> : undefined;

  return (
    <>
      <DashboardHeader ctx={ctx} />

      {depot ? (
        <DepotPanel ctx={ctx} side={cashBook} />
      ) : (
        <>
          <QuickActions quick={quick} label={t("দ্রুত কাজ")} />
          {cashBook && <div className="mb-4 max-w-md" id="general-cash-book">{cashBook}</div>}
        </>
      )}
    </>
  );
}

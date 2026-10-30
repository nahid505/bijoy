import Link from "next/link";
import { BusinessSwitcher } from "@/components/business-switcher";
import { MobileNav, Sidebar, type SidebarEntry } from "@/components/sidebar";
import { formatDate, toBnDigits } from "@/lib/format";
import { MOBILE_TABS, NAV, NAV_LABEL_EN } from "@/lib/nav";
import { businessModules, type BusinessModule } from "@/lib/business-types";
import { hasPermission } from "@/lib/permissions";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { featureForPath } from "@/lib/features";
import { requireContext } from "@/server/auth";
import { fiscalYearRange } from "@/server/period";
import { logoutAction } from "@/server/actions/auth";
import { getLang, getT } from "@/server/i18n";
import { LangToggle } from "@/components/lang";
import { SubscriptionBanner } from "@/components/subscription-banner";
import { unreadCount, visibleKinds } from "@/server/services/notifications";
import { isRestricted, notificationScopeWhere } from "@/server/party-scope";
import { reportOpenFor, reportSlugForPath } from "@/server/reports/registry";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  // pages of a switched-off feature are refused here (server side), not only hidden from the menu
  const path = (await headers()).get("x-pathname") ?? "";
  // suspended subscription: only billing / own account stay open (enforced in permissions as well)
  if (ctx.subscription?.blocked && !/^\/(billing|account|forbidden)(\/|$)/.test(path)) redirect("/billing?suspended=1");
  const gate = featureForPath(path);
  if (gate && !ctx.features.includes(gate)) redirect(`/forbidden?feature=${gate}`);
  const t = await getT();
  const en = (await getLang()) === "en";
  const navLabel = (label: string) => (en && NAV_LABEL_EN[label]) || t(label);
  const featureOn = (href: string) => {
    const f = featureForPath(href);
    return !f || ctx.features.includes(f);
  };
  // assigned-only roles: menu entries of business-wide reports they may not open are hidden
  const reportOk = (href: string) => {
    if (href === "/backup" && isRestricted(ctx)) return false; // a backup holds every party
    const slug = reportSlugForPath(href);
    return !slug || reportOpenFor(ctx, slug);
  };
  // modules the business's types switch on (settings → "ব্যবসার ধরন ও মডিউল"); core menus have no module
  const modules = businessModules(ctx.business.businessTypes);
  const moduleOn = (m?: BusinessModule) => !m || modules.has(m);
  const allowed = (p?: Parameters<typeof hasPermission>[1], href?: string) => (!p || hasPermission(ctx.permissions, p)) && (!href || (featureOn(href) && reportOk(href)));

  const entries: SidebarEntry[] = NAV.flatMap((e): SidebarEntry[] => {
    if (!moduleOn(e.module)) return [];
    if (e.children) {
      const children = e.children.filter((c) => moduleOn(c.module) && !(c.hiddenWithModule && modules.has(c.hiddenWithModule)) && allowed(c.permission, c.href)).map(({ href, label, icon }) => ({ href, label: navLabel(label), icon }));
      return children.length ? [{ key: e.key, label: navLabel(e.label), icon: e.icon, children, highlight: e.highlight }] : [];
    }
    return allowed(e.permission, e.href) ? [{ key: e.key, label: navLabel(e.label), icon: e.icon, href: e.href }] : [];
  });
  const tabs = MOBILE_TABS.filter((x) => moduleOn(x.module) && allowed(x.permission, x.href)).map((x) => ({ ...x, label: navLabel(x.label) }));
  const fy = fiscalYearRange(ctx.business.fiscalYearStartMonth);
  const alertKinds = visibleKinds((p) => allowed(p as Parameters<typeof hasPermission>[1]), ctx.features);
  const unread = alertKinds.length ? await unreadCount(ctx.business.id, ctx.user.id, alertKinds, notificationScopeWhere(ctx)) : 0;

  return (
    <div className="min-h-screen">
      <Sidebar entries={entries} businessName={ctx.business.name} />
      <div className="lg:pl-60 print:p-0">
        <header className="no-print sticky top-0 z-20 flex min-h-[64px] sm:min-h-0 sm:h-14 items-center gap-2 border-b border-rule bg-white px-3 sm:px-6 pt-3.5 pb-2.5 sm:py-0 shadow-2xs">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base sm:text-sm font-bold text-ink-900 leading-tight">{ctx.business.name}</p>
            <p className="truncate text-xs sm:text-[11px] text-slate-500 leading-tight mt-0.5">
              {t("অর্থবছর")} {toBnDigits(fy.label)} · {t("আজ")} {formatDate(new Date())}
            </p>
          </div>
          {alertKinds.length > 0 && (
            <Link
              prefetch={false}
              href="/notifications"
              className="relative flex h-10 w-10 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg border border-rule text-base hover:bg-ink-50 transition"
              aria-label={`${t("নোটিফিকেশন")}${unread ? ` (${toBnDigits(unread)} ${t("অপঠিত")})` : ""}`}
              title={t("নোটিফিকেশন")}
            >
              <span aria-hidden>🔔</span>
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4.5 min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-xs">
                  {unread > 99 ? "৯৯+" : toBnDigits(unread)}
                </span>
              )}
            </Link>
          )}
          {ctx.user.isSuperAdmin && (
            <Link prefetch={false} href="/admin" className="hidden shrink-0 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 sm:block">Super Admin</Link>
          )}
          <LangToggle />
          <BusinessSwitcher current={ctx.business.id} businesses={ctx.businesses} />
          <Link prefetch={false} href="/account" className="hidden text-right leading-tight hover:opacity-80 sm:block">
            <p className="text-xs font-semibold text-ink-800">{ctx.user.name}</p>
            <p className="text-[11px] text-slate-500">{ctx.roleName}</p>
          </Link>
          <form action={logoutAction} className="shrink-0">
            <button
              type="submit"
              className="flex h-10 min-w-[40px] sm:h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 sm:px-3 text-sm font-medium text-slate-700 shadow-2xs transition hover:border-slate-400 hover:bg-slate-50"
              aria-label={t("লগআউট")}
              title={t("লগআউট")}
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
              <span className="hidden sm:inline">{t("লগআউট")}</span>
            </button>
          </form>
        </header>
        <MobileNav entries={entries} tabs={tabs} businessName={ctx.business.name} />
        <SubscriptionBanner sub={ctx.subscription} canBill={hasPermission(ctx.permissions, "billing:view")} />
        <main className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6 print:max-w-none print:p-0">{children}</main>
      </div>
    </div>
  );
}

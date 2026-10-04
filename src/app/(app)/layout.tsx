import Link from "next/link";
import { BusinessSwitcher } from "@/components/business-switcher";
import { MobileNav, Sidebar, type SidebarEntry } from "@/components/sidebar";
import { formatDate, toBnDigits } from "@/lib/format";
import { MOBILE_TABS, NAV } from "@/lib/nav";
import { hasPermission } from "@/lib/permissions";
import { requireContext } from "@/server/auth";
import { fiscalYearRange } from "@/server/period";
import { logoutAction } from "@/server/actions/auth";
import { getT } from "@/server/i18n";
import { LangToggle } from "@/components/lang";
import { unreadCount, visibleKinds } from "@/server/services/notifications";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const t = await getT();
  const allowed = (p?: Parameters<typeof hasPermission>[1]) => !p || hasPermission(ctx.permissions, p);

  const entries: SidebarEntry[] = NAV.flatMap((e): SidebarEntry[] => {
    if (e.children) {
      const children = e.children.filter((c) => allowed(c.permission)).map(({ href, label }) => ({ href, label: t(label) }));
      return children.length ? [{ key: e.key, label: t(e.label), icon: e.icon, children }] : [];
    }
    return allowed(e.permission) ? [{ key: e.key, label: t(e.label), icon: e.icon, href: e.href }] : [];
  });
  const tabs = MOBILE_TABS.filter((x) => allowed(x.permission)).map((x) => ({ ...x, label: t(x.label) }));
  const fy = fiscalYearRange(ctx.business.fiscalYearStartMonth);
  const alertKinds = visibleKinds((p) => allowed(p as Parameters<typeof hasPermission>[1]));
  const unread = alertKinds.length ? await unreadCount(ctx.business.id, ctx.user.id, alertKinds) : 0;

  return (
    <div className="min-h-screen">
      <Sidebar entries={entries} businessName={ctx.business.name} />
      <MobileNav entries={entries} tabs={tabs} businessName={ctx.business.name} />
      <div className="pb-16 lg:pb-0 lg:pl-60 print:p-0">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-1.5 border-b border-rule bg-white px-3 sm:gap-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink-900">{ctx.business.name}</p>
            <p className="truncate text-[11px] text-slate-500">
              {t("অর্থবছর")} {toBnDigits(fy.label)} · {t("আজ")} {formatDate(new Date())}
            </p>
          </div>
          {alertKinds.length > 0 && (
            <Link
              prefetch={false}
              href="/notifications"
              className="relative shrink-0 rounded border border-rule px-2 py-1 text-sm hover:bg-ink-50"
              aria-label={`${t("নোটিফিকেশন")}${unread ? ` (${toBnDigits(unread)} ${t("অপঠিত")})` : ""}`}
              title={t("নোটিফিকেশন")}
            >
              <span aria-hidden>🔔</span>
              {unread > 0 && (
                <span className="absolute -right-1.5 -top-1.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[1.1rem] text-white">
                  {unread > 99 ? "৯৯+" : toBnDigits(unread)}
                </span>
              )}
            </Link>
          )}
          <LangToggle />
          <BusinessSwitcher current={ctx.business.id} businesses={ctx.businesses} />
          <Link prefetch={false} href="/account" className="hidden text-right leading-tight hover:opacity-80 sm:block">
            <p className="text-xs font-semibold text-ink-800">{ctx.user.name}</p>
            <p className="text-[11px] text-slate-500">{ctx.roleName}</p>
          </Link>
          <form action={logoutAction} className="shrink-0">
            <button type="submit" className="btn-secondary btn-sm" aria-label={t("লগআউট")} title={t("লগআউট")}>
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 sm:hidden" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
              <span className="hidden sm:inline">{t("লগআউট")}</span>
            </button>
          </form>
        </header>
        <main className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6 print:max-w-none print:p-0">{children}</main>
      </div>
    </div>
  );
}

// Dashboard panels for the SaaS account (company, plan, subscription, users, features), recent
// purchases and the latest notifications. Everything is read for the caller's own business only.
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatDate, formatMoney, toBnDigits } from "@/lib/format";
import { SUB_STATUS_LABELS, type SubStatus } from "@/lib/subscription";
import { Badge, EmptyState } from "@/components/ui";
import { can, type AppContext } from "@/server/auth";
import { visibleKinds } from "@/server/services/notifications";
import { subscriptionState, userUsage } from "@/server/services/subscriptions";
import { notificationScopeWhere } from "@/server/party-scope";
import { getLang, getT } from "@/server/i18n";
import { notificationLocalizer } from "@/server/notification-locale";

export async function AccountSummary({ ctx }: { ctx: AppContext }) {
  const biz = ctx.business.id;
  const [state, usage] = await Promise.all([subscriptionState(biz), userUsage(biz)]);
  if (!state) return null;
  const status = state.effective.status as SubStatus;
  const st = SUB_STATUS_LABELS[status];
  const end = state.sub.status === "TRIAL" ? state.sub.trialEndsAt : state.sub.endDate;
  const billing = can(ctx, "billing:view");
  const cell = "flex flex-col gap-0.5 px-4 py-3";
  const t = await getT();
  const en = (await getLang()) === "en";
  return (
    <section className="panel mb-4" aria-label={t("অ্যাকাউন্ট ও সাবস্ক্রিপশন")}>
      <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        <div className={`${cell} col-span-2 sm:col-span-1`}>
          <span className="figure-label">{t("কোম্পানি")}</span>
          <span className="truncate font-semibold text-ink-900" title={ctx.business.name}>{ctx.business.name}</span>
        </div>
        <div className={cell}>
          <span className="figure-label">{t("প্ল্যান")}</span>
          <span className="font-semibold text-ink-900">{en ? state.plan.nameEn : state.plan.nameBn}</span>
        </div>
        <div className={cell}>
          <span className="figure-label">{t("অবস্থা")}</span>
          <span><Badge tone={st.tone}>{en ? st.en : st.bn}</Badge></span>
        </div>
        <div className={cell}>
          <span className="figure-label">{t(state.sub.status === "TRIAL" ? "ট্রায়াল শেষ" : "মেয়াদ")}</span>
          <span className="font-semibold text-ink-900">{end ? formatDate(end) : t("সীমাহীন")}</span>
          {state.effective.daysLeft !== null && state.effective.daysLeft >= 0 && <span className="text-[11px] text-slate-500">{t("{n} দিন বাকি", { n: toBnDigits(state.effective.daysLeft) })}</span>}
        </div>
        <div className={cell}>
          <span className="figure-label">{t("ব্যবহারকারী")}</span>
          <span className="font-semibold tabular-nums text-ink-900">{toBnDigits(usage.used)} / {usage.limit === null ? t("সীমাহীন") : toBnDigits(usage.limit)}</span>
        </div>
        <div className={cell}>
          <span className="figure-label">{t("চালু ফিচার")}</span>
          <span className="font-semibold tabular-nums text-ink-900">{toBnDigits(ctx.features.length)}</span>
          {billing && <Link prefetch={false} href="/billing" className="text-[11px] font-medium text-brand-700 hover:underline">{t(status === "TRIAL" || status === "EXPIRED" || status === "EXPIRING" ? "প্ল্যান নির্বাচন / পেমেন্ট →" : "সাবস্ক্রিপশন →")}</Link>}
        </div>
      </div>
    </section>
  );
}

export async function RecentPurchases({ ctx }: { ctx: AppContext }) {
  if (!can(ctx, "purchases:view") || !ctx.features.includes("PURCHASE")) return null;
  const cur = ctx.business.currencySymbol;
  const rows = await prisma.voucher.findMany({ where: { businessId: ctx.business.id, book: "GENERAL", type: "PURCHASE" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 7, include: { partyAccount: { select: { name: true } } } });
  const t = await getT();
  return (
    <PanelBox title={t("সাম্প্রতিক ক্রয়")} href="/vouchers/purchase" linkLabel={t("সব দেখুন")}>
      {rows.length === 0 ? <EmptyState message="এখনও কোনো ক্রয় নেই" /> : (
        <table className="table">
          <tbody>
            {rows.map((v) => {
              const due = num(v.amount) - num(v.paidAmount);
              return (
                <tr key={v.id}>
                  <td>
                    <Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-semibold text-brand-700 hover:underline">{v.voucherNo}</Link>
                    <span className="block text-xs text-slate-500">{formatDate(v.date)} · {v.partyAccount?.name ?? t("নগদ ক্রয়")}</span>
                  </td>
                  <td className="num">
                    {formatMoney(num(v.amount), cur)}
                    <span className="block">{due > 0 ? <Badge tone="amber">{t("দেনা")} {formatMoney(due, cur)}</Badge> : <Badge tone="green">{t("পরিশোধিত")}</Badge>}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </PanelBox>
  );
}

const SEV = { CRITICAL: "🔴", WARNING: "🟠", INFO: "🔵" } as const;

export async function LatestNotifications({ ctx }: { ctx: AppContext }) {
  const kinds = visibleKinds((p) => can(ctx, p as never), ctx.features);
  if (!kinds.length) return null;
  const rows = await prisma.notification.findMany({ where: { businessId: ctx.business.id, ...notificationScopeWhere(ctx), resolvedAt: null, kind: { in: kinds } }, orderBy: [{ severity: "asc" }, { createdAt: "desc" }], take: 6 });
  const t = await getT();
  const loc = await notificationLocalizer();
  return (
    <PanelBox title={t("নোটিফিকেশন")} href="/notifications" linkLabel={t("সব দেখুন")}>
      {rows.length === 0 ? <EmptyState message="নতুন কোনো নোটিফিকেশন নেই ✅" /> : (
        <ul className="divide-y divide-rule">
          {rows.map((n) => (
            <li key={n.id} className="px-4 py-2.5 text-sm">
              {n.link ? <Link prefetch={false} href={n.link} className="font-medium text-ink-900 hover:text-brand-700">{SEV[n.severity]} {loc(n.title)}</Link> : <span className="font-medium text-ink-900">{SEV[n.severity]} {loc(n.title)}</span>}
              <span className="block truncate text-xs text-slate-500" title={loc(n.message)}>{loc(n.message)}</span>
            </li>
          ))}
        </ul>
      )}
    </PanelBox>
  );
}

function PanelBox({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2 className="panel-title">{title}</h2><Link prefetch={false} href={href} className="text-xs font-medium text-brand-700 hover:underline">{linkLabel}</Link></div>
      {children}
    </section>
  );
}

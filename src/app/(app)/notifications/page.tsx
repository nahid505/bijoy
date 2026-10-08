import type { Metadata } from "next";
import Link from "next/link";
import type { NotificationKind, Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { formatDateTime, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { ActionButton } from "@/components/forms";
import { Badge, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { can, requireContext } from "@/server/auth";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { markNotificationsReadAction, runChecksNowAction } from "@/server/actions/expiry";
import { ensureDailyChecks, visibleKinds } from "@/server/services/notifications";

export const metadata: Metadata = { title: "নোটিফিকেশন" };

const TABS: { key: string; label: string; kinds?: NotificationKind[]; history?: boolean }[] = [
  { key: "active", label: "সক্রিয়" },
  { key: "expired", label: "🔴 মেয়াদোত্তীর্ণ", kinds: ["EXPIRED"] },
  { key: "expiring", label: "🟠 শীঘ্রই মেয়াদ শেষ", kinds: ["EXPIRY_WARNING"] },
  { key: "low", label: "কম স্টক", kinds: ["LOW_STOCK"] },
  { key: "overdue", label: "বকেয়া আদায়", kinds: ["OVERDUE"] },
  { key: "sms", label: "এসএমএস", kinds: ["SMS_BALANCE_LOW"] },
  { key: "account", label: "সাবস্ক্রিপশন ও অ্যাকাউন্ট", kinds: ["TRIAL_STARTED", "SUBSCRIPTION_ACTIVATED", "SUBSCRIPTION_EXPIRING", "SUBSCRIPTION_EXPIRED", "PAYMENT_SUCCESS", "PAYMENT_FAILED", "PLAN_CHANGED", "USER_ADDED", "FEATURE_CHANGED"] },
  { key: "history", label: "ইতিহাস (সমাধান হয়েছে)", history: true },
];

const KIND_LABEL: Record<NotificationKind, string> = {
  EXPIRED: "মেয়াদোত্তীর্ণ", EXPIRY_WARNING: "মেয়াদ সতর্কতা", LOW_STOCK: "কম স্টক", OVERDUE: "বকেয়া", SMS_BALANCE_LOW: "এসএমএস ব্যালেন্স",
  SUBSCRIPTION_EXPIRING: "সাবস্ক্রিপশনের মেয়াদ", SUBSCRIPTION_EXPIRED: "সাবস্ক্রিপশন শেষ", PAYMENT_SUCCESS: "পেমেন্ট সফল", PAYMENT_FAILED: "পেমেন্ট ব্যর্থ",
  PLAN_CHANGED: "প্ল্যান পরিবর্তন", USER_ADDED: "নতুন ব্যবহারকারী", FEATURE_CHANGED: "ফিচার পরিবর্তন",
  TRIAL_STARTED: "রেজিস্ট্রেশন ও ট্রায়াল", SUBSCRIPTION_ACTIVATED: "সাবস্ক্রিপশন সক্রিয়",
};
const ICON = { CRITICAL: "🔴", WARNING: "🟠", INFO: "🔵" } as const;

export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireContext();
  const p = await readParams(searchParams);
  const kinds = visibleKinds((perm) => can(ctx, perm as never), ctx.features);
  const cur = ctx.business.currencySymbol;
  if (kinds.length === 0) {
    return (
      <>
        <PageHeader title="নোটিফিকেশন" crumbs={[{ label: "নোটিফিকেশন" }]} />
        <section className="panel"><EmptyState message="আপনার রোলের জন্য কোনো নোটিফিকেশন নেই" /></section>
      </>
    );
  }
  await ensureDailyChecks(ctx.business.id); // in case the scheduler has not run yet today

  const tab = TABS.find((t) => t.key === p.tab) ?? TABS[0];
  const tabKinds = (tab.kinds ?? kinds).filter((k) => kinds.includes(k));
  const where: Prisma.NotificationWhereInput = {
    businessId: ctx.business.id,
    kind: { in: tabKinds },
    ...(tab.history ? { resolvedAt: { not: null } } : { resolvedAt: null }),
  };
  const { page, skip, take } = pageOf(p);
  const [rows, total, counts, lastRun] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: tab.history ? [{ resolvedAt: "desc" }] : [{ severity: "asc" }, { createdAt: "desc" }],
      include: { reads: { where: { userId: ctx.user.id }, select: { readAt: true } } },
      skip,
      take,
    }),
    prisma.notification.count({ where }),
    prisma.notification.groupBy({ by: ["kind"], where: { businessId: ctx.business.id, kind: { in: kinds }, resolvedAt: null }, _count: true }),
    prisma.jobRun.findFirst({ where: { businessId: ctx.business.id, job: "daily-check" }, orderBy: { runOn: "desc" }, select: { finishedAt: true } }),
  ]);
  const countOf = (k?: NotificationKind[]) => counts.filter((c) => !k || k.includes(c.kind)).reduce((s, c) => s + c._count, 0);
  const unreadIds = rows.filter((r) => r.reads.length === 0 && !r.resolvedAt).map((r) => r.id);

  return (
    <>
      <PageHeader
        title="নোটিফিকেশন"
        description={`মেয়াদ, কম স্টক ও বকেয়ার সতর্কবার্তা — প্রতিদিন স্বয়ংক্রিয়ভাবে যাচাই হয়${lastRun?.finishedAt ? ` (সর্বশেষ ${formatDateTime(lastRun.finishedAt)})` : ""}। পড়া হলেও সতর্কবার্তা মুছে যায় না; সমস্যা সমাধান হলে ইতিহাসে চলে যায়।`}
        crumbs={[{ label: "নোটিফিকেশন" }]}
        actions={
          <>
            {unreadIds.length > 0 && <ActionButton action={markNotificationsReadAction.bind(null, null)} label="সব পড়া হয়েছে" className="btn-secondary" />}
            <ActionButton action={runChecksNowAction} label="↻ এখনই যাচাই করুন" className="btn-primary" />
          </>
        }
      />
      <section className="panel">
        <nav className="flex flex-wrap gap-1 border-b border-rule px-3 pt-3" aria-label="নোটিফিকেশনের ধরন">
          {TABS.filter((t) => !t.kinds || t.kinds.some((k) => kinds.includes(k))).map((t) => {
            const n = t.history ? null : countOf(t.kinds);
            const active = t.key === tab.key;
            return (
              <Link
                prefetch={false}
                key={t.key}
                href={`/notifications?tab=${t.key}`}
                aria-current={active ? "page" : undefined}
                className={`rounded-t-md px-3 py-2 text-sm ${active ? "border border-b-white border-rule bg-white font-semibold text-ink-900" : "text-slate-500 hover:text-ink-900"}`}
              >
                {t.label}
                {n ? <span className="ml-1 rounded-full bg-ink-100 px-1.5 text-[11px]">{toBnDigits(n)}</span> : null}
              </Link>
            );
          })}
        </nav>
        {rows.length === 0 ? (
          <EmptyState message={tab.history ? "এখনো কোনো সমাধান হওয়া সতর্কবার্তা নেই" : "কোনো সক্রিয় সতর্কবার্তা নেই ✅"} />
        ) : (
          <ul className="divide-y divide-rule">
            {rows.map((n) => {
              const unread = n.reads.length === 0 && !n.resolvedAt;
              return (
                <li key={n.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start ${unread ? "bg-amber-50/40" : ""}`}>
                  <span aria-hidden className="text-lg leading-6">{ICON[n.severity]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm ${unread ? "font-bold" : "font-semibold"} text-ink-900`}>{n.title}</p>
                      <Badge tone={n.severity === "CRITICAL" ? "red" : n.severity === "WARNING" ? "amber" : "blue"}>{KIND_LABEL[n.kind]}</Badge>
                      {unread && <Badge tone="blue">নতুন</Badge>}
                      {n.resolvedAt && <Badge tone="green">সমাধান হয়েছে</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-700">{n.message}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      তৈরি {formatDateTime(n.createdAt)}
                      {n.updatedAt.getTime() - n.createdAt.getTime() > 60_000 && !n.resolvedAt ? ` · হালনাগাদ ${formatDateTime(n.updatedAt)}` : ""}
                      {n.resolvedAt ? ` · সমাধান ${formatDateTime(n.resolvedAt)}` : ""}
                      {n.quantity !== null && n.kind !== "OVERDUE" ? ` · পরিমাণ ${formatQty(num(n.quantity))}` : ""}
                      {n.amount !== null ? ` · ${formatMoney(num(n.amount), cur)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-2">
                    {n.link && <Link prefetch={false} href={n.link} className="btn-secondary btn-sm">দেখুন</Link>}
                    {unread && <ActionButton action={markNotificationsReadAction.bind(null, [n.id])} label="পড়া হয়েছে" className="btn-ghost btn-sm" />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination basePath="/notifications" params={p} page={page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}

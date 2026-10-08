import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney, toBnDigits } from "@/lib/format";
import { BUSINESS_TYPE_LABELS } from "@/lib/business-types";
import { CYCLE_LABELS, SUB_STATUS_LABELS, type SubStatus } from "@/lib/subscription";
import { ActionButton } from "@/components/forms";
import { FeatureComparison, PlanCards } from "@/components/plan-cards";
import { Badge, DetailRow, EmptyState, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { setAutoRenewAction, switchToFreePlanAction } from "@/server/actions/billing";
import { loadPlans } from "@/server/billing/plans";
import { subscriptionState, userUsage } from "@/server/services/subscriptions";

export const metadata: Metadata = { title: "সাবস্ক্রিপশন ও বিলিং" };

const PAYMENT_STATUS: Record<string, { label: string; tone: "green" | "amber" | "red" | "slate" | "blue" }> = {
  INITIATED: { label: "শুরু হয়েছে", tone: "slate" }, PENDING: { label: "যাচাই চলছে", tone: "amber" }, SUCCESS: { label: "সফল", tone: "green" },
  FAILED: { label: "ব্যর্থ", tone: "red" }, CANCELLED: { label: "বাতিল", tone: "slate" }, REFUNDED: { label: "ফেরত", tone: "blue" },
};

export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("billing:view");
  const p = await readParams(searchParams);
  const biz = ctx.business.id;
  const cycle = p.cycle === "YEARLY" ? "YEARLY" : "MONTHLY";
  const manage = can(ctx, "billing:manage");
  const [state, usage, { plans, features, settings }, business, txns, invoices, events] = await Promise.all([
    subscriptionState(biz),
    userUsage(biz),
    loadPlans({ publicOnly: true, activeOnly: true }),
    prisma.business.findUniqueOrThrow({ where: { id: biz } }),
    prisma.paymentTransaction.findMany({ where: { businessId: biz }, orderBy: { createdAt: "desc" }, take: 20, include: { plan: { select: { nameBn: true } } } }),
    prisma.invoice.findMany({ where: { businessId: biz }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.subscriptionEvent.findMany({ where: { businessId: biz }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const cur = settings.currency === "BDT" ? "৳" : settings.currency;
  const sub = state?.sub;
  const eff = state?.effective;
  const status = (eff?.status ?? "EXPIRED") as SubStatus;
  const st = SUB_STATUS_LABELS[status];
  const end = sub?.status === "TRIAL" ? sub.trialEndsAt : sub?.endDate;

  return (
    <>
      <PageHeader title="সাবস্ক্রিপশন ও বিলিং" description="আপনার প্ল্যান, মেয়াদ, ব্যবহারকারী, পেমেন্ট ও ইনভয়েস" crumbs={[{ label: "সাবস্ক্রিপশন" }]} />
      {status === "EXPIRED" && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200" role="alert">
          {sub?.trialEndsAt && sub.endDate && sub.trialEndsAt.getTime() === sub.endDate.getTime() ? "আপনার ফ্রি ট্রায়াল শেষ হয়েছে।" : "আপনার সাবস্ক্রিপশনের মেয়াদ শেষ হয়েছে।"} সব তথ্য সংরক্ষিত আছে — নিচে একটি প্ল্যান নির্বাচন করে পেমেন্ট করুন, অথবা ফ্রি প্ল্যানে চালিয়ে যান।
        </p>
      )}
      {p.suspended && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200" role="alert">সাবস্ক্রিপশন স্থগিত{sub?.suspendReason ? `: ${sub.suspendReason}` : ""} — অন্যান্য পাতা বন্ধ আছে। পেমেন্ট বা সহায়তার জন্য বিজয় লেনদেনের সাথে যোগাযোগ করুন।</p>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="বর্তমান প্ল্যান" value={state ? `${state.plan.nameBn}` : "—"} hint={sub ? `${CYCLE_LABELS[sub.billingCycle]}${sub.autoRenew ? " · স্বয়ংক্রিয় নবায়ন" : ""}` : undefined} tone="blue" />
        <StatCard label="অবস্থা" value={st.bn} hint={end ? `মেয়াদ ${formatDate(end)}${eff?.daysLeft !== null && eff?.daysLeft !== undefined && eff.daysLeft >= 0 ? ` · আর ${toBnDigits(eff.daysLeft)} দিন` : ""}` : "মেয়াদ নেই (চলমান)"} tone={st.tone === "green" ? "green" : st.tone === "red" ? "red" : "amber"} />
        <StatCard label="ব্যবহারকারী" value={`${toBnDigits(usage.used)} / ${usage.limit === null ? "সীমাহীন" : toBnDigits(usage.limit)}`} hint={usage.limit !== null && usage.used >= usage.limit ? "সীমা পূর্ণ — আরও যোগ করতে আপগ্রেড করুন" : undefined} tone={usage.limit !== null && usage.used >= usage.limit ? "amber" : "slate"} />
        <StatCard label="চালু ফিচার" value={toBnDigits(ctx.features.length)} hint={`প্ল্যানে ${toBnDigits(ctx.entitled.length)}টি`} tone="green" />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <section className="panel">
          <div className="panel-head flex items-center justify-between"><h2 className="panel-title">প্রতিষ্ঠানের তথ্য</h2>{can(ctx, "business:manage") && <Link prefetch={false} href="/business" className="text-xs text-brand-700 hover:underline">সম্পাদনা</Link>}</div>
          <dl className="p-4">
            <DetailRow label="নাম">{business.name}</DetailRow>
            <DetailRow label="ধরন">{business.businessType ? BUSINESS_TYPE_LABELS[business.businessType as keyof typeof BUSINESS_TYPE_LABELS] ?? business.businessType : "—"}</DetailRow>
            <DetailRow label="মোবাইল">{business.mobile ?? "—"}</DetailRow>
            <DetailRow label="ঠিকানা">{business.address ?? "—"}</DetailRow>
            {(business.binNumber || business.tinNumber) && <DetailRow label="BIN / TIN">{[business.binNumber, business.tinNumber].filter(Boolean).join(" / ")}</DetailRow>}
            <DetailRow label="সদস্য হয়েছেন">{formatDate(business.createdAt)}</DetailRow>
          </dl>
        </section>
        <section className="panel lg:col-span-2">
          <div className="panel-head"><h2 className="panel-title">সাবস্ক্রিপশন</h2></div>
          <dl className="p-4">
            <DetailRow label="প্ল্যান">{state?.plan.nameBn} ({state?.plan.nameEn})</DetailRow>
            <DetailRow label="অবস্থা"><Badge tone={st.tone}>{st.bn}</Badge>{eff?.inGrace && <span className="ml-2 text-xs text-amber-700">গ্রেস পিরিয়ড {eff.accessUntil ? formatDate(eff.accessUntil) : ""} পর্যন্ত</span>}</DetailRow>
            <DetailRow label="শুরু">{sub ? formatDate(sub.startDate) : "—"}</DetailRow>
            <DetailRow label={sub?.status === "TRIAL" ? "ট্রায়াল শেষ" : "মেয়াদ শেষ"}>{end ? formatDate(end) : "চলমান (মেয়াদ নেই)"}</DetailRow>
            <DetailRow label="গ্রেস পিরিয়ড">{toBnDigits(settings.graceDays)} দিন</DetailRow>
            <DetailRow label="স্বয়ংক্রিয় নবায়ন">
              {sub?.autoRenew ? "চালু" : "বন্ধ"}
              {manage && sub && state && num(state.plan.priceMonthly) > 0 && (
                <span className="ml-2 inline-block">
                  <ActionButton action={setAutoRenewAction.bind(null, !sub.autoRenew)} label={sub.autoRenew ? "বন্ধ করুন" : "চালু করুন"} className="btn-ghost btn-sm" />
                </span>
              )}
            </DetailRow>
          </dl>
          <p className="px-4 pb-4 text-xs text-slate-500">স্বয়ংক্রিয় নবায়ন চালু থাকলে মেয়াদ শেষের আগে নবায়নের পেমেন্ট লিংক পাঠানো হবে। মেয়াদ শেষ হলেও কোনো তথ্য মুছে যায় না — শুধু প্ল্যানের অতিরিক্ত ফিচার বন্ধ হয়।</p>
        </section>
      </div>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-900">প্ল্যান — আপগ্রেড বা নবায়ন</h2>
          <nav className="flex gap-1 text-sm" aria-label="বিলিং সময়কাল">
            {(["MONTHLY", "YEARLY"] as const).map((c) => (
              <Link key={c} prefetch={false} href={`/billing?cycle=${c}`} className={`rounded-full px-3 py-1 ${cycle === c ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-rule"}`}>{CYCLE_LABELS[c]}</Link>
            ))}
          </nav>
        </div>
        <PlanCards
          plans={plans}
          features={features}
          cycle={cycle}
          currency={cur}
          current={state?.plan.id}
          cta={(plan) =>
            !manage ? null : plan.free ? (
              state?.plan.id === plan.id ? <span className="text-sm text-slate-500">বর্তমান প্ল্যান</span> : (
                <ActionButton action={switchToFreePlanAction} label="ফ্রি প্ল্যানে যান" className="btn-secondary w-full" confirmText="ফ্রি প্ল্যানে গেলে অতিরিক্ত ফিচার বন্ধ হবে (তথ্য মুছে যাবে না)। নিশ্চিত?" />
              )
            ) : (
              <Link prefetch={false} href={`/billing/checkout?plan=${plan.id}&cycle=${cycle}`} className={`${state?.plan.id === plan.id ? "btn-secondary" : "btn-primary"} w-full`}>
                {state?.plan.id === plan.id && sub?.status !== "TRIAL" ? "নবায়ন করুন" : "এই প্ল্যান নিন"}
              </Link>
            )
          }
        />
        <details className="panel mt-4">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink-800">সব ফিচারের তুলনা</summary>
          <FeatureComparison plans={plans} features={features} />
        </details>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">পেমেন্ট ইতিহাস</h2></div>
          {txns.length === 0 ? <EmptyState message="এখনো কোনো পেমেন্ট নেই" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>তারিখ</th><th>প্ল্যান</th><th>মাধ্যম</th><th className="text-right">টাকা</th><th>অবস্থা</th><th>ট্রানজেকশন</th></tr></thead>
                <tbody>
                  {txns.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-sm">{formatDateTime(t.createdAt)}</td>
                      <td className="text-sm">{t.plan.nameBn} · {CYCLE_LABELS[t.billingCycle]}</td>
                      <td className="text-sm">{t.provider}</td>
                      <td className="num">{formatMoney(num(t.amount), cur)}</td>
                      <td><Badge tone={PAYMENT_STATUS[t.status].tone}>{PAYMENT_STATUS[t.status].label}</Badge>{t.status === "INITIATED" && t.provider === "manual" && manage && <Link prefetch={false} href={`/billing/manual?txn=${t.id}`} className="ml-1 text-xs text-brand-700 hover:underline">TrxID দিন</Link>}</td>
                      <td className="font-mono text-xs">{t.providerTrxId ?? t.manualReference ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">ইনভয়েস</h2></div>
          {invoices.length === 0 ? <EmptyState message="এখনো কোনো ইনভয়েস নেই" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>নম্বর</th><th>তারিখ</th><th>সময়কাল</th><th className="text-right">মোট</th><th>অবস্থা</th></tr></thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td><Link prefetch={false} href={`/billing/invoices/${i.id}`} className="font-mono text-xs font-medium hover:text-brand-700 hover:underline">{i.number}</Link></td>
                      <td className="text-sm">{formatDate(i.createdAt)}</td>
                      <td className="text-sm">{formatDate(i.periodStart)} — {formatDate(i.periodEnd)}</td>
                      <td className="num">{formatMoney(num(i.total), cur)}</td>
                      <td><Badge tone={i.status === "PAID" ? "green" : "slate"}>{i.status === "PAID" ? "পরিশোধিত" : i.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </section>
      </div>

      {events.length > 0 && (
        <section className="panel mt-4">
          <div className="panel-head"><h2 className="panel-title">সাবস্ক্রিপশনের ইতিহাস</h2></div>
          <ul className="divide-y divide-rule text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span><b className="font-medium">{e.type}</b>{e.fromPlanCode || e.toPlanCode ? ` · ${[e.fromPlanCode, e.toPlanCode].filter(Boolean).join(" → ")}` : ""}{e.note ? ` · ${e.note}` : ""}</span>
                <span className="text-xs text-slate-500">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

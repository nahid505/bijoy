import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney, toBnDigits, toDateInput } from "@/lib/format";
import { FEATURES, type FeatureDef } from "@/lib/features";
import { businessTypesText } from "@/lib/business-types";
import { strList } from "@/lib/dialect";
import { CYCLE_LABELS, SUB_STATUS_LABELS, effectiveStatus } from "@/lib/subscription";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms";
import { Badge, DetailRow, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { adminApprovePaymentAction, adminChangePlanAction, adminExtendAction, adminFeatureOverrideAction, adminRejectPaymentAction, adminSuspendAction } from "@/server/actions/admin";
import { loadFeatureAccess } from "@/server/services/feature-state";
import { companyDetail } from "@/server/services/platform-admin";
import { platformSettings } from "@/server/services/subscriptions";

export const metadata: Metadata = { title: "কোম্পানি — সুপার অ্যাডমিন" };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [b, plans, settings] = await Promise.all([companyDetail(id), prisma.plan.findMany({ orderBy: { sortOrder: "asc" } }), platformSettings()]);
  if (!b) notFound();
  const access = await loadFeatureAccess(b.id);
  const sub = b.subscription;
  const eff = sub ? effectiveStatus(sub, new Date(), { graceDays: settings.graceDays, reminderDays: settings.reminderWindow }) : null;
  const planKeys = new Set((await prisma.planFeature.findMany({ where: { planId: sub?.planId ?? "" } })).map((f) => f.featureKey));
  const rows = new Map(b.features.map((f) => [f.featureKey, f]));
  const end = sub?.status === "TRIAL" ? sub.trialEndsAt : sub?.endDate;

  return (
    <>
      <PageHeader title={b.name} description={[businessTypesText(strList(b.businessTypes)), b.mobile, b.email].filter(Boolean).join(" · ")} crumbs={[{ label: "কোম্পানি", href: "/admin/companies" }, { label: b.name }]} />
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">সাবস্ক্রিপশন</h2></div>
          {sub ? (
            <dl className="p-4">
              <DetailRow label="প্ল্যান">{sub.plan.nameBn} ({CYCLE_LABELS[sub.billingCycle]})</DetailRow>
              <DetailRow label="অবস্থা">{eff && <Badge tone={SUB_STATUS_LABELS[eff.status].tone}>{SUB_STATUS_LABELS[eff.status].bn}</Badge>}<span className="ml-1 text-xs text-slate-400">(সংরক্ষিত: {sub.status})</span></DetailRow>
              <DetailRow label="শুরু">{formatDate(sub.startDate)}</DetailRow>
              <DetailRow label="শেষ">{end ? `${formatDate(end)}${eff?.daysLeft !== null && eff?.daysLeft !== undefined ? ` (${toBnDigits(eff.daysLeft)} দিন)` : ""}` : "চলমান"}</DetailRow>
              <DetailRow label="স্বয়ংক্রিয় নবায়ন">{sub.autoRenew ? "চালু" : "বন্ধ"}</DetailRow>
              {sub.suspendReason && <DetailRow label="স্থগিতের কারণ">{sub.suspendReason}</DetailRow>}
              <DetailRow label="ব্যবহারকারী">{toBnDigits(b.memberships.filter((m) => m.isActive).length)} / {sub.plan.userLimit === null ? "সীমাহীন" : toBnDigits(sub.plan.userLimit)}</DetailRow>
            </dl>
          ) : <EmptyState message="সাবস্ক্রিপশন নেই" />}
        </section>
        <section className="panel space-y-4 p-4 lg:col-span-2">
          <h2 className="panel-title">নিয়ন্ত্রণ</h2>
          <ActionForm action={adminChangePlanAction.bind(null, b.id)} className="grid gap-2 sm:grid-cols-5 sm:items-end">
            <Field label="প্ল্যান পরিবর্তন" name="planId">
              <select id="planId" name="planId" defaultValue={sub?.planId} className="input">{plans.map((p) => <option key={p.id} value={p.id}>{p.nameBn}{p.isActive ? "" : " (নিষ্ক্রিয়)"}</option>)}</select>
            </Field>
            <Field label="সময়কাল" name="cycle"><select id="cycle" name="cycle" defaultValue={sub?.billingCycle ?? "MONTHLY"} className="input"><option value="MONTHLY">মাসিক</option><option value="YEARLY">বার্ষিক</option></select></Field>
            <Field label="মেয়াদ শেষ (ঐচ্ছিক)" name="endDate"><input id="endDate" name="endDate" type="date" className="input" defaultValue={sub?.endDate ? toDateInput(sub.endDate) : ""} /></Field>
            <Field label="নোট" name="note"><input id="note" name="note" className="input" /></Field>
            <SubmitButton className="btn-primary">পরিবর্তন করুন</SubmitButton>
          </ActionForm>
          <ActionForm action={adminExtendAction.bind(null, b.id)} className="grid gap-2 sm:grid-cols-5 sm:items-end">
            <Field label="মেয়াদ বাড়ান (দিন)" name="days"><input id="days" name="days" type="text" inputMode="decimal" data-numeric min="1" max="3650" defaultValue="30" className="input-num" /></Field>
            <Field label="নোট" name="note" className="sm:col-span-3"><input id="extend-note" name="note" className="input" placeholder="যেমন: প্রমোশনাল ৩০ দিন" /></Field>
            <SubmitButton className="btn-secondary">বাড়ান</SubmitButton>
          </ActionForm>
          {sub && (
            <ActionForm action={adminSuspendAction.bind(null, b.id, sub.status !== "SUSPENDED")} className="grid gap-2 sm:grid-cols-5 sm:items-end">
              <Field label={sub.status === "SUSPENDED" ? "আবার চালু করার নোট" : "স্থগিতের কারণ"} name="reason" className="sm:col-span-4"><input id="reason" name="reason" className="input" /></Field>
              <SubmitButton className={sub.status === "SUSPENDED" ? "btn-primary" : "btn-danger"}>{sub.status === "SUSPENDED" ? "আবার চালু করুন" : "স্থগিত করুন"}</SubmitButton>
            </ActionForm>
          )}
        </section>
      </div>

      <section className="panel mb-4">
        <div className="panel-head"><h2 className="panel-title">ফিচার (প্ল্যান + সুপার অ্যাডমিন ওভাররাইড)</h2></div>
        <TableWrap>
          <table className="table">
            <thead><tr><th>ফিচার</th><th>প্ল্যানে</th><th>সুপার অ্যাডমিন ওভাররাইড</th><th>ফলাফল</th><th /></tr></thead>
            <tbody>
              {(FEATURES as readonly FeatureDef[]).map((f) => {
                const row = rows.get(f.key);
                const override = row?.adminOverride ?? null;
                const on = access.on.has(f.key as never);
                return (
                  <tr key={f.key}>
                    <td><span aria-hidden>{f.icon}</span> {f.nameBn}{f.status === "COMING_SOON" && <span className="ml-1 text-xs text-slate-400">(শীঘ্রই)</span>}</td>
                    <td>{planKeys.has(f.key) ? "✓" : "—"}</td>
                    <td>{override === null ? <span className="text-slate-400">প্ল্যান অনুযায়ী</span> : override ? <Badge tone="green">সবসময় চালু</Badge> : <Badge tone="red">বন্ধ</Badge>}</td>
                    <td>{on ? <Badge tone="green">চালু</Badge> : <Badge tone="slate">বন্ধ</Badge>}</td>
                    <td className="whitespace-nowrap">
                      {f.status === "AVAILABLE" && (
                        <span className="inline-flex gap-1">
                          {override !== true && <ActionButton action={adminFeatureOverrideAction.bind(null, b.id, f.key, "on")} label="চালু" className="btn-ghost btn-sm" />}
                          {override !== false && <ActionButton action={adminFeatureOverrideAction.bind(null, b.id, f.key, "off")} label="বন্ধ" className="btn-ghost btn-sm text-credit" />}
                          {override !== null && <ActionButton action={adminFeatureOverrideAction.bind(null, b.id, f.key, "plan")} label="প্ল্যান অনুযায়ী" className="btn-ghost btn-sm" />}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </section>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">ব্যবহারকারী</h2></div>
          <TableWrap>
            <table className="table">
              <thead><tr><th>নাম</th><th>রোল</th><th>শেষ লগইন</th><th>অবস্থা</th></tr></thead>
              <tbody>
                {b.memberships.map((m) => (
                  <tr key={m.id}>
                    <td>{m.user.name}<span className="block text-xs text-slate-400">{m.user.email ?? m.user.mobile}</span></td>
                    <td className="text-sm">{m.role.name}</td>
                    <td className="text-sm">{m.user.lastLoginAt ? formatDateTime(m.user.lastLoginAt) : "—"}</td>
                    <td>{m.isActive && m.user.isActive ? <Badge tone="green">সক্রিয়</Badge> : <Badge tone="slate">নিষ্ক্রিয়</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </section>
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">পেমেন্ট ও ইনভয়েস</h2></div>
          {b.paymentTransactions.length === 0 ? <EmptyState message="কোনো পেমেন্ট নেই" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>তারিখ</th><th>প্ল্যান</th><th>মাধ্যম</th><th className="text-right">টাকা</th><th>অবস্থা</th><th /></tr></thead>
                <tbody>
                  {b.paymentTransactions.map((t) => (
                    <tr key={t.id}>
                      <td className="text-sm">{formatDateTime(t.createdAt)}</td>
                      <td className="text-sm">{t.plan.nameBn}</td>
                      <td className="text-sm">{t.provider}<span className="block font-mono text-xs text-slate-400">{t.providerTrxId ?? t.manualReference ?? ""}</span></td>
                      <td className="num">{formatMoney(num(t.amount), "৳")}</td>
                      <td className="text-sm">{t.status}</td>
                      <td>{t.status === "PENDING" && t.provider === "manual" && (
                        <span className="inline-flex gap-1">
                          <ActionButton action={adminApprovePaymentAction.bind(null, t.id)} label="অনুমোদন" className="btn-primary btn-sm" confirmText={`TrxID ${t.manualReference} এর ${formatMoney(num(t.amount), "৳")} পাওয়া গেছে নিশ্চিত?`} />
                          <ActionButton action={adminRejectPaymentAction.bind(null, t.id)} label="প্রত্যাখ্যান" className="btn-ghost btn-sm text-credit" confirmText="পেমেন্ট প্রত্যাখ্যান করবেন?" />
                        </span>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          {b.saasInvoices.length > 0 && (
            <ul className="divide-y divide-rule border-t border-rule text-sm">
              {b.saasInvoices.map((i) => (
                <li key={i.id} className="flex justify-between px-4 py-2"><Link prefetch={false} href={`/admin/invoices/${i.id}`} className="font-mono text-xs hover:underline">{i.number}</Link><span>{formatMoney(num(i.total), "৳")} · {formatDate(i.createdAt)}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {sub && (
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">সাবস্ক্রিপশনের ইতিহাস</h2></div>
          <ul className="divide-y divide-rule text-sm">
            {sub.events.map((e) => (
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

import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { adminSaveSettingsAction } from "@/server/actions/admin";
import { allBillingProviders } from "@/server/billing/providers";
import { platformSettings } from "@/server/services/subscriptions";

export const metadata: Metadata = { title: "সেটিং — সুপার অ্যাডমিন" };

export default async function PlatformSettingsPage() {
  const [s, plans] = await Promise.all([platformSettings(), prisma.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } })]);
  const providers = allBillingProviders();
  return (
    <>
      <PageHeader title="প্ল্যাটফর্ম সেটিং" description="ট্রায়াল, গ্রেস পিরিয়ড, রিমাইন্ডার, ভ্যাট ও ইনভয়েস" />
      <section className="panel mb-4 p-5">
        <ActionForm action={adminSaveSettingsAction} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="ফ্রি ট্রায়াল (দিন)" name="trialDays"><input id="trialDays" name="trialDays" type="number" min="0" max="365" defaultValue={s.trialDays} className="input-num" /></Field>
            <Field label="ট্রায়ালের প্ল্যান" name="trialPlanCode"><select id="trialPlanCode" name="trialPlanCode" defaultValue={s.trialPlanCode} className="input">{plans.map((p) => <option key={p.code} value={p.code}>{p.nameBn}</option>)}</select></Field>
            <Field label="মেয়াদ শেষে প্ল্যান (ফলব্যাক)" name="fallbackPlanCode"><select id="fallbackPlanCode" name="fallbackPlanCode" defaultValue={s.fallbackPlanCode} className="input">{plans.map((p) => <option key={p.code} value={p.code}>{p.nameBn}</option>)}</select></Field>
            <Field label="গ্রেস পিরিয়ড (দিন)" name="graceDays"><input id="graceDays" name="graceDays" type="number" min="0" max="90" defaultValue={s.graceDays} className="input-num" /></Field>
            <Field label="রিমাইন্ডার (দিন আগে)" name="reminderDays" hint="কমা দিয়ে, যেমন 7, 3, 1"><input id="reminderDays" name="reminderDays" defaultValue={s.reminderDays.join(", ")} className="input" /></Field>
            <Field label="ভ্যাট (%)" name="vatPercent"><input id="vatPercent" name="vatPercent" type="number" min="0" max="50" step="0.01" defaultValue={s.vatPercent} className="input-num" /></Field>
            <Field label="মুদ্রা" name="currency"><input id="currency" name="currency" defaultValue={s.currency} className="input uppercase" /></Field>
            <Field label="ইনভয়েস প্রিফিক্স" name="invoicePrefix"><input id="invoicePrefix" name="invoicePrefix" defaultValue={s.invoicePrefix} className="input" /></Field>
          </div>
          <SubmitButton>সংরক্ষণ করুন</SubmitButton>
        </ActionForm>
      </section>
      <section className="panel p-5">
        <h2 className="panel-title mb-2">পেমেন্ট গেটওয়ে</h2>
        <p className="mb-3 text-sm text-slate-600">গেটওয়ের কী/পাসওয়ার্ড শুধু সার্ভারের এনভায়রনমেন্ট ভেরিয়েবলে থাকে (কোডে বা ডেটাবেসে নয়)।</p>
        <ul className="divide-y divide-rule text-sm">
          {providers.map((p) => (
            <li key={p.id} className="flex justify-between py-2"><span>{p.labelBn} <span className="text-xs text-slate-400">{p.id}</span></span><span className={p.configured() ? "font-medium text-brand-700" : "text-slate-400"}>{p.configured() ? "চালু" : "কনফিগার করা হয়নি"}</span></li>
          ))}
        </ul>
      </section>
    </>
  );
}

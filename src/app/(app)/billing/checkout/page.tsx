import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatMoney } from "@/lib/format";
import { CYCLE_LABELS, nextPeriod, type Cycle } from "@/lib/subscription";
import { ActionForm, SubmitButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { startCheckoutAction } from "@/server/actions/billing";
import { allBillingProviders } from "@/server/billing/providers";
import { checkoutAmounts, subscriptionState } from "@/server/services/subscriptions";

export const metadata: Metadata = { title: "পেমেন্ট" };

export default async function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("billing:manage");
  const p = await readParams(searchParams);
  const cycle: Cycle = p.cycle === "YEARLY" ? "YEARLY" : "MONTHLY";
  if (!p.plan) notFound();
  const amounts = await checkoutAmounts(p.plan, cycle).catch(() => null);
  if (!amounts || amounts.total <= 0) notFound();
  const state = await subscriptionState(ctx.business.id);
  const period = state ? nextPeriod({ status: state.sub.status, endDate: state.sub.endDate, planId: state.sub.planId, trial: state.sub.status === "TRIAL" }, amounts.plan.id, cycle, new Date()) : null;
  const providers = allBillingProviders();
  const cur = amounts.currency === "BDT" ? "৳" : amounts.currency;

  return (
    <>
      <PageHeader title="পেমেন্ট" description={`${amounts.plan.nameBn} প্ল্যান — ${CYCLE_LABELS[cycle]}`} crumbs={[{ label: "সাবস্ক্রিপশন", href: "/billing" }, { label: "পেমেন্ট" }]} />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel p-5 lg:col-span-2">
          <h2 className="panel-title mb-3">পেমেন্ট মাধ্যম</h2>
          <ActionForm action={startCheckoutAction} className="space-y-3">
            <input type="hidden" name="planId" value={amounts.plan.id} />
            <input type="hidden" name="cycle" value={cycle} />
            <fieldset className="space-y-2">
              <legend className="sr-only">পেমেন্ট মাধ্যম</legend>
              {providers.map((pr, i) => {
                const ok = pr.configured();
                return (
                  <label key={pr.id} className={`flex items-center gap-3 rounded-md border p-3 ${ok ? "cursor-pointer border-rule hover:bg-ink-50" : "border-dashed border-slate-200 text-slate-400"}`}>
                    <input type="radio" name="provider" value={pr.id} disabled={!ok} defaultChecked={ok && providers.findIndex((x) => x.configured()) === i} />
                    <span className="flex-1"><span className="font-medium">{pr.labelBn}</span> <span className="text-xs text-slate-500">{pr.labelEn}</span></span>
                    {!ok && <span className="text-xs">শীঘ্রই / কনফিগার করা হয়নি</span>}
                  </label>
                );
              })}
            </fieldset>
            <p className="text-xs text-slate-500">পেমেন্ট সফল ও যাচাই হওয়ার পরেই সাবস্ক্রিপশন চালু হবে। একই পেমেন্ট দুবার কাটা হবে না।</p>
            <div className="flex gap-2">
              <SubmitButton pendingText="অপেক্ষা করুন…">{`${formatMoney(amounts.total, cur)} পরিশোধ করুন`}</SubmitButton>
              <Link prefetch={false} href="/billing" className="btn-secondary">ফিরে যান</Link>
            </div>
          </ActionForm>
        </section>
        <aside className="panel p-5 text-sm">
          <h2 className="panel-title mb-3">সারসংক্ষেপ</h2>
          <dl className="space-y-1.5">
            <div className="flex justify-between"><dt>প্ল্যান</dt><dd className="font-medium">{amounts.plan.nameBn}</dd></div>
            <div className="flex justify-between"><dt>সময়কাল</dt><dd>{CYCLE_LABELS[cycle]}</dd></div>
            {period && <div className="flex justify-between gap-2"><dt>মেয়াদ</dt><dd className="text-right">{formatDate(period.start)} — {formatDate(period.end)}</dd></div>}
            <div className="flex justify-between border-t border-rule pt-1.5"><dt>মূল্য</dt><dd className="tabular-nums">{formatMoney(amounts.subtotal, cur)}</dd></div>
            {amounts.discount > 0 && <div className="flex justify-between"><dt>ছাড়</dt><dd className="tabular-nums">−{formatMoney(amounts.discount, cur)}</dd></div>}
            <div className="flex justify-between"><dt>ভ্যাট ({amounts.vatPercent}%)</dt><dd className="tabular-nums">{formatMoney(amounts.vatAmount, cur)}</dd></div>
            <div className="flex justify-between border-t border-rule pt-1.5 text-base font-bold"><dt>মোট</dt><dd className="tabular-nums">{formatMoney(amounts.total, cur)}</dd></div>
          </dl>
          {period?.renewal && <p className="mt-3 text-xs text-brand-700">বর্তমান মেয়াদ শেষ হওয়ার পর থেকে নবায়ন হবে — কোনো দিন নষ্ট হবে না।</p>}
        </aside>
      </div>
    </>
  );
}

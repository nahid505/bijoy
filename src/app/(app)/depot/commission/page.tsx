import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { DEPOT_ACCESS, isDepot } from "@/lib/depot";
import { formatMoney, toBnDigits, toDateInput } from "@/lib/format";
import { EmptyState, PageHeader, StatCard, TableWrap } from "@/components/ui";
import { getT } from "@/server/i18n";
import { can, requirePermission } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { settleCommissionAction, transferCommissionAction } from "@/server/actions/depot";
import { commissionSummary, transferableCommission } from "@/server/services/depot";
import { CommissionTransferForm } from "./transfer-form";
import { DepotOnlyNotice } from "../depot-ui";
import { CommissionSettleForm } from "./settle-form";
import { accountScopeWhere, canSeeParty, isRestricted } from "@/server/party-scope";

export const metadata: Metadata = { title: "কোম্পানি কমিশন হিসাব" };

export default async function DepotCommissionPage() {
  const ctx = await requirePermission(DEPOT_ACCESS.commission);
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  const cur = ctx.business.currencySymbol;
  const [summary, cash, transfer] = await Promise.all([
    commissionSummary(ctx.business.id),
    prisma.account.findMany({ where: { businessId: ctx.business.id, kind: { in: ["CASH", "BANK"] }, isActive: true, ...accountScopeWhere(ctx) }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    transferableCommission(ctx.business.id),
  ]);
  // supplier-restricted users: only their own companies
  summary.rows = summary.rows.filter((r) => canSeeParty(ctx, "SUPPLIER", r.companyAccountId));
  summary.outstanding = summary.rows.reduce((s, r) => s + r.outstanding, 0);
  const earned = summary.rows.reduce((s, r) => s + r.earned, 0);
  const settled = summary.rows.reduce((s, r) => s + r.settled, 0);
  const t = await getT();
  return (
    <>
      <PageHeader
        title="কোম্পানি কমিশন হিসাব"
        description="ডিও রিলিজ চালান থেকে অর্জিত কমিশন, আদায়/সমন্বয় এবং কোম্পানির কাছে বর্তমান প্রাপ্য"
        crumbs={[{ label: "ডিপো ব্যবস্থাপনা" }, { label: "কোম্পানি কমিশন" }]}
        actions={<Link prefetch={false} href="/reports/depot-commission" className="btn-secondary">{t("কমিশন রিপোর্ট (প্রিন্ট/এক্সেল)")}</Link>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="মোট অর্জিত কমিশন" value={formatMoney(earned, cur)} tone="blue" />
        <StatCard label="আদায় / সমন্বয় হয়েছে" value={formatMoney(settled, cur)} tone="green" />
        <StatCard label="কোম্পানির কাছে মোট প্রাপ্য" value={formatMoney(summary.outstanding, cur)} tone="amber" />
      </div>
      <section className="panel mb-5">
        <div className="panel-head"><h2 className="panel-title">{t("কোম্পানিভিত্তিক কমিশন")}</h2></div>
        {summary.rows.length === 0 ? <EmptyState message="এখনও কোনো ডিও রিলিজ চালান নেই — প্রথম কমিশন আসবে ডিও রিলিজ থেকে" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>{t("কোম্পানি")}</th><th className="text-right">{t("ডিও চালান")}</th><th className="text-right">{t("অর্জিত")}</th><th className="text-right">{t("আদায়/সমন্বয়")}</th><th className="text-right">{t("প্রাপ্য")}</th><th /></tr></thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.companyAccountId}>
                    <td className="font-semibold"><Link prefetch={false} href={`/reports/depot-company-ledger?accountId=${r.companyAccountId}`} className="text-brand-700 hover:underline">{r.company}</Link></td>
                    <td className="num">{toBnDigits(r.deliveries)}</td>
                    <td className="num">{formatMoney(r.earned, cur)}</td>
                    <td className="num">{formatMoney(r.settled, cur)}</td>
                    <td className={`num font-bold ${r.outstanding < 0 ? "text-credit" : ""}`}>{formatMoney(r.outstanding, cur)}</td>
                    <td className="text-right"><Link prefetch={false} href={`/accounts/${r.receivableAccountId}`} className="text-sm text-brand-700 hover:underline">{t("লেজার")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
      {can(ctx, DEPOT_ACCESS.settle) && (
        <section className="panel p-5">
          <h2 className="mb-3 text-base font-semibold text-ink-900">{t("কমিশন আদায় / সমন্বয়")}</h2>
          <CommissionSettleForm
            action={settleCommissionAction}
            companies={summary.rows.map((r) => ({ id: r.companyAccountId, name: r.company, outstanding: r.outstanding }))}
            cashAccounts={cash.map((a) => ({ ...a, group: "" }))}
            today={toDateInput()}
            dateLocked={!canChangeEntryDate(ctx)}
            currency={cur}
          />
        </section>
      )}
      {!isRestricted(ctx) && (
      <section className="panel mt-4 p-5" id="commission-transfer">
        <h2 className="text-base font-semibold text-ink-900">{t("কমিশন সাধারণ আয়ে স্থানান্তর")}</h2>
        <p className="mb-3 mt-1 text-sm text-slate-600">
          {t("ডিপোর হিসাব সাধারণ ব্যবসা থেকে সম্পূর্ণ আলাদা। শুধু অর্জিত কোম্পানি কমিশন এখান থেকে সাধারণ আয়ে নেওয়া যায় — ডিপোর নগদ থেকে বের হয়ে সাধারণ নগদে \"ডিপো কমিশন আয় (স্থানান্তরিত)\" হিসেবে যোগ হবে।")}
        </p>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="মোট অর্জিত কমিশন" value={formatMoney(transfer.earned, cur)} />
          <StatCard label="ইতিমধ্যে স্থানান্তরিত" value={formatMoney(transfer.transferred, cur)} tone="blue" />
          <StatCard label="স্থানান্তরযোগ্য" value={formatMoney(transfer.available, cur)} tone="green" />
        </div>
        {can(ctx, "vouchers:create") ? (
          <CommissionTransferForm action={transferCommissionAction} available={transfer.available} cashAccounts={cash.map((a) => ({ ...a, group: "" }))} today={toDateInput()} dateLocked={!canChangeEntryDate(ctx)} currency={cur} />
        ) : (
          <p className="text-sm text-slate-500">{t('স্থানান্তর সাধারণ হিসাবে এন্ট্রি দেয় — এর জন্য "ভাউচার তৈরি" অনুমতি লাগবে।')}</p>
        )}
      </section>
      )}
    </>
  );
}

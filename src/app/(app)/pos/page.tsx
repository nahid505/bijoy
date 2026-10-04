import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatMoney, toDateInput } from "@/lib/format";
import { PosScreen } from "@/components/pos";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { accountOptions, inventoryOptions } from "@/server/voucher-editor";
import type { PartyOption } from "@/components/trade-parts";
import { saveVoucherAction } from "@/server/actions/vouchers";

export const metadata: Metadata = { title: "পস বিক্রয়" };

export default async function PosPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("sales:create");
  const p = await readParams(searchParams);
  const businessId = ctx.business.id;
  const [customers, cashAccounts, inv, last] = await Promise.all([
    Promise.resolve([] as PartyOption[]), // the customer picker searches on demand
    accountOptions(businessId, { kind: { in: ["CASH", "BANK"] } }),
    inventoryOptions(businessId),
    p.last ? prisma.voucher.findFirst({ where: { id: p.last, businessId, type: "SALES" }, select: { id: true, voucherNo: true, amount: true } }) : null,
  ]);
  return (
    <>
      <PageHeader
        title="পস বিক্রয়"
        description="দ্রুত বিক্রয় — বারকোড স্ক্যান, একাধিক পেমেন্ট মাধ্যম, বাকি ও ক্রেডিট সীমা যাচাই"
        actions={<Link prefetch={false} href="/vouchers/sales/new" className="btn-secondary">বিস্তারিত বিক্রয় ফর্ম</Link>}
      />
      {last && (
        <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-900">
          <span>সর্বশেষ বিক্রয় <b>{last.voucherNo}</b> — {formatMoney(num(last.amount), ctx.business.currencySymbol)}</span>
          <span className="flex gap-2">
            <Link prefetch={false} href={`/vouchers/v/${last.id}/print`} className="btn-secondary btn-sm">🧾 ইনভয়েস প্রিন্ট</Link>
            <Link prefetch={false} href={`/vouchers/v/${last.id}`} className="btn-ghost btn-sm">দেখুন</Link>
          </span>
        </div>
      )}
      <PosScreen
        key={p.last ?? "pos"}
        action={saveVoucherAction.bind(null, "SALES", null)}
        customers={customers}
        cashAccounts={cashAccounts}
        {...inv}
        defaultVat={ctx.business.defaultVatPercent}
        currency={ctx.business.currencySymbol}
        today={toDateInput()}
        allowExpiredSale={ctx.business.allowExpiredSale}
      />
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { num } from "@/lib/db";
import { TRADE_TYPES, VOUCHER_TYPES } from "@/lib/accounting";
import { paymentStatus, PAYMENT_STATUS_LABELS, round2 } from "@/lib/calc";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { ActionButton } from "@/components/forms";
import { PaddySlip, toPaddySlipData } from "@/components/paddy-slip";
import { DepotChallan } from "@/components/depot-challan";
import { Badge, DetailRow, PageHeader, TableWrap } from "@/components/ui";
import { can, requireContext } from "@/server/auth";
import { batchesOfItem, loadVoucher } from "@/server/voucher-detail";
import { voucherAccess, voucherPermission } from "@/server/voucher-permissions";
import { deleteVoucherAction } from "@/server/actions/vouchers";
import { redirect } from "next/navigation";
import { isPayrollVoucher } from "@/server/services/voucher";
import { DEPOT_ACCESS } from "@/lib/depot";
import { canSeeVoucher } from "@/server/party-scope";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "ভাউচার" };

export default async function VoucherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const t = await getT();
  const v = await loadVoucher(ctx.business.id, id);
  if (!v) notFound();
  if (!can(ctx, voucherAccess(v.type, "view", ctx.business.businessType, v.book)) && !(v.type === "OPENING" && can(ctx, "accounts:view"))) redirect("/forbidden");
  if (!(await canSeeVoucher(ctx, v.id))) redirect("/forbidden"); // assigned-only roles: another party's voucher
  // opened through a depot permission only (depot-only role): the voucher, without the ledger postings
  const full = can(ctx, voucherPermission(v.type, "view")) || v.type === "OPENING";
  const depotOnly = !full;
  // a depot-book voucher (src/lib/book.ts) lives under the depot menu, never in the general lists
  const depotBook = v.book === "DEPOT" || depotOnly;
  const depotList = v.depotDelivery ? "/depot/deliveries" : ({ PURCHASE: "/depot/stock-in", PURCHASE_RETURN: "/depot/stock-in", RECEIPT: "/depot/collections", PAYMENT: "/depot/payments", JOURNAL: "/depot/commission", STOCK_JOURNAL: "/depot/stock-adjust" } as Record<string, string>)[v.type];
  const cur = ctx.business.currencySymbol;
  const meta = VOUCHER_TYPES[v.type];
  const trade = TRADE_TYPES.includes(v.type);
  const dr = round2(v.entries.reduce((s, e) => s + num(e.debit), 0));
  const cr = round2(v.entries.reduce((s, e) => s + num(e.credit), 0));
  const amount = num(v.amount);
  const paid = num(v.paidAmount);
  const st = paymentStatus(amount, paid);
  const payroll = isPayrollVoucher(v.sourceKey);
  const editable = v.type !== "OPENING" && !payroll;
  // payroll vouchers are changed from the payroll module only
  const payrollHref = !payroll ? null : v.sourceKey!.startsWith("payroll:run:") ? `/payroll/runs/${v.sourceKey!.slice("payroll:run:".length)}` : v.sourceKey!.startsWith("payroll:advance:") ? "/payroll/advances" : "/payroll/payments";
  const hasBatches = v.items.some((i) => i.batchNo || i.stockMovements.length > 0);
  const party = v.partyAccount?.customer ?? v.partyAccount?.supplier;
  const partyHref = depotOnly ? null : v.partyAccount?.customer ? `/customers/${v.partyAccount.customer.id}` : v.partyAccount?.supplier ? `/suppliers/${v.partyAccount.supplier.id}` : v.partyAccount ? `/accounts/${v.partyAccountId}` : null;

  return (
    <>
      <PageHeader
        title={`${t(meta.long)} · ${v.voucherNo}${depotBook ? ` (${t("ডিপো হিসাব")})` : ""}`}
        description={`${formatDate(v.date)}${v.partyAccount ? ` · ${v.partyAccount.name}` : ""}`}
        crumbs={depotBook ? [{ label: "ডিপো ব্যবস্থাপনা" }, { label: v.depotDelivery ? "ডেলিভারি চালান" : meta.label, href: depotList }, { label: v.voucherNo }] : [{ label: "লেনদেন" }, { label: meta.label, href: v.type === "PRODUCTION" ? "/production" : v.depotDelivery ? "/depot/deliveries" : editable ? `/vouchers/${meta.slug}` : undefined }, { label: v.voucherNo }]}
        actions={
          <>
            {v.depotDelivery ? (
              <>
                <Link prefetch={false} href={`/depot/deliveries/${v.id}/print`} className="btn-primary">{t("🖨 প্রিন্ট চালান (ডিলার কপি)")}</Link>
                <Link prefetch={false} href={`/vouchers/v/${v.id}/print`} className="btn-secondary" title={t("কমিশন সহ — শুধু অফিসের জন্য")}>{t("অফিস কপি")}</Link>
              </>
            ) : (
              <Link prefetch={false} href={`/vouchers/v/${v.id}/print`} className="btn-primary">{t(v.type === "SALES" ? "🧾 ইনভয়েস / প্রিন্ট" : "🖨 প্রিন্ট / PDF")}</Link>
            )}
            {v.type === "SALES" && can(ctx, "sales:create") && <Link prefetch={false} href={`/vouchers/sales-return/new?from=${v.id}`} className="btn-secondary">{t("↩ ফেরত নিন")}</Link>}
            {v.type === "PURCHASE" && can(ctx, "purchases:create") && <Link prefetch={false} href={`/vouchers/purchase-return/new?from=${v.id}`} className="btn-secondary">{t("↩ ফেরত দিন")}</Link>}
            {v.type === "SALES" && v.partyAccountId && amount - paid > 0 && can(ctx, v.book === "DEPOT" ? DEPOT_ACCESS.collection : "vouchers:create") && <Link prefetch={false} href={v.book === "DEPOT" ? `/depot/collections/new?party=${v.partyAccountId}` : `/vouchers/receipt/new?party=${v.partyAccountId}`} className="btn-secondary">{t("বাকি আদায়")}</Link>}
            {payrollHref && can(ctx, "payroll:view") && <Link prefetch={false} href={payrollHref} className="btn-secondary">{t("বেতন মডিউলে দেখুন")}</Link>}
            {editable && can(ctx, voucherAccess(v.type, "edit", ctx.business.businessType, v.book)) && <Link prefetch={false} href={v.type === "PRODUCTION" ? `/production/${v.id}/edit` : v.paddyPurchase ? `/purchases/paddy/${v.id}/edit` : v.depotDelivery ? `/depot/deliveries/${v.id}/edit` : `/vouchers/v/${v.id}/edit`} className="btn-secondary">{t("সম্পাদনা")}</Link>}
            {editable && can(ctx, voucherAccess(v.type, "delete", ctx.business.businessType, v.book)) && (
              <ActionButton action={deleteVoucherAction.bind(null, v.id)} label={t("মুছুন")} className="btn-danger" confirmText={t("ভাউচারটি মুছে ফেললে সংশ্লিষ্ট সব জার্নাল এন্ট্রি ও স্টক মুভমেন্ট বাতিল হবে। নিশ্চিত?")} />
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {full && (
        <section className="panel lg:col-span-2">
          <div className="panel-head">
            <h2 className="panel-title">{t("জার্নাল এন্ট্রি")}</h2>
            <Badge tone={dr === cr ? "green" : "red"}>{dr === cr ? t("ডেবিট = ক্রেডিট ✔") : t("অসমতা!")}</Badge>
          </div>
          <TableWrap>
            <table className="table">
              <thead><tr><th>{t("হিসাব (লেজার)")}</th><th>{t("গ্রুপ")}</th><th className="num">{t("ডেবিট")}</th><th className="num">{t("ক্রেডিট")}</th></tr></thead>
              <tbody>
                {v.entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link prefetch={false} href={`/accounts/${e.account.id}`} className="font-medium hover:text-brand-700 hover:underline">{num(e.credit) > 0 ? <span className="pl-6">{e.account.name}</span> : e.account.name}</Link>
                      {e.narration && <span className="block text-xs text-slate-500">{e.narration}</span>}
                    </td>
                    <td className="text-xs text-slate-500">{e.account.group.name}</td>
                    <td className="num dr">{num(e.debit) ? formatMoney(num(e.debit), cur) : ""}</td>
                    <td className="num cr">{num(e.credit) ? formatMoney(num(e.credit), cur) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={2}>{t("মোট")}</td><td className="num">{formatMoney(dr, cur)}</td><td className="num">{formatMoney(cr, cur)}</td></tr></tfoot>
            </table>
          </TableWrap>
        </section>
        )}

        <section className={depotOnly ? "panel lg:col-span-3" : "panel"}>
          <div className="panel-head"><h2 className="panel-title">ভাউচার তথ্য</h2>{trade && <Badge tone={st === "PAID" ? "green" : st === "PARTIAL" ? "amber" : "red"}>{PAYMENT_STATUS_LABELS[st]}</Badge>}</div>
          <dl className="divide-y divide-rule px-4 py-1">
            <DetailRow label="ভাউচার নং">{v.voucherNo}</DetailRow>
            <DetailRow label="তারিখ">{formatDate(v.date)}</DetailRow>
            {v.partyAccount && <DetailRow label="পার্টি / হিসাব">{partyHref ? <Link prefetch={false} href={partyHref} className="text-brand-700 hover:underline">{v.partyAccount.name}</Link> : v.partyAccount.name}{party?.mobile ? ` (${party.mobile})` : ""}</DetailRow>}
            {v.payments.length > 0
              ? v.payments.map((pm) => <DetailRow key={pm.id} label={`পেমেন্ট: ${pm.account.name}`}>{formatMoney(num(pm.amount), cur)}{pm.reference ? ` (${pm.reference})` : ""}</DetailRow>)
              : v.cashAccount && !trade && <DetailRow label="নগদ/ব্যাংক">{v.cashAccount.name}</DetailRow>}
            {v.dueDate && <DetailRow label="পরিশোধের শেষ তারিখ">{formatDate(v.dueDate)}</DetailRow>}
            {v.returnOf && <DetailRow label="মূল ইনভয়েস"><Link prefetch={false} href={`/vouchers/v/${v.returnOf.id}`} className="text-brand-700 hover:underline">{v.returnOf.voucherNo}</Link></DetailRow>}
            {v.returns.map((r) => <DetailRow key={r.id} label="ফেরত"><Link prefetch={false} href={`/vouchers/v/${r.id}`} className="text-brand-700 hover:underline">{r.voucherNo}</Link> · {formatMoney(num(r.amount), cur)}</DetailRow>)}
            {v.warehouse && <DetailRow label="গুদাম">{v.warehouse.name}</DetailRow>}
            {v.reference && <DetailRow label="রেফারেন্স">{v.reference}</DetailRow>}
            {trade && <DetailRow label="উপমোট">{formatMoney(num(v.subtotal), cur)}</DetailRow>}
            {trade && num(v.discount) > 0 && <DetailRow label="ছাড়">{formatMoney(num(v.discount), cur)}</DetailRow>}
            {trade && num(v.vatAmount) > 0 && <DetailRow label={`ভ্যাট (${formatQty(num(v.vatPercent))}%)`}>{formatMoney(num(v.vatAmount), cur)}</DetailRow>}
            <DetailRow label="মোট টাকা">{formatMoney(amount, cur)}</DetailRow>
            {trade && <DetailRow label="নগদে লেনদেন">{formatMoney(paid, cur)}</DetailRow>}
            {trade && <DetailRow label="বাকি"><span className={amount - paid > 0 ? "text-credit" : ""}>{formatMoney(amount - paid, cur)}</span></DetailRow>}
            {v.narration && v.narration !== v.paddyPurchase?.notes && <DetailRow label="বিবরণ">{v.narration}</DetailRow>}
            <DetailRow label="তৈরি">{v.createdBy.name} · {formatDateTime(v.createdAt)}</DetailRow>
            {v.updatedBy && <DetailRow label="সর্বশেষ সম্পাদনা">{v.updatedBy.name} · {formatDateTime(v.updatedAt)}</DetailRow>}
          </dl>
        </section>
      </div>

      {v.depotDelivery && <div className="panel mt-4 px-4"><DepotChallan currency={cur} d={{ mode: v.depotDelivery.mode, doNumber: v.depotDelivery.doNumber, company: v.depotDelivery.companyAccount?.name ?? null, dealer: v.depotDelivery.dealerAccount?.name ?? null, route: v.depotDelivery.dealerAccount?.customer?.route ?? null, dealerMobile: v.depotDelivery.dealerAccount?.customer?.mobile ?? null, vehicleNo: v.depotDelivery.vehicleNo, driverName: v.depotDelivery.driverName, commission: num(v.depotDelivery.commissionTotal), notes: v.depotDelivery.notes }} /></div>}
      {v.paddyPurchase && <div className="panel mt-4 px-4">{v.paddyPurchase && <PaddySlip currency={cur} d={toPaddySlipData(v.paddyPurchase)} />}</div>}
      {v.items.length > 0 && (
        <section className="panel mt-4">
          <div className="panel-head"><h2 className="panel-title">{t("পণ্যের বিবরণ")}</h2></div>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("পণ্য")}</th>
                  {v.type === "STOCK_JOURNAL" && <th>{t("গুদাম")}</th>}
                  {v.type === "STOCK_JOURNAL" && <th>{t("দিক")}</th>}
                  <th className="num">{t("পরিমাণ")}</th>
                  <th className="num">{t(v.type === "DEPOT_DELIVERY" ? "কমিশন হার" : "দর")}</th>
                  {trade && <th className="num">{t("ছাড়")}</th>}
                  {hasBatches && <th>{t("ব্যাচ / মেয়াদ")}</th>}
                  <th className="num">{t(v.type === "DEPOT_DELIVERY" ? "কমিশন" : "টাকা")}</th>
                  <th className="num">{t("ক্রয়মূল্য (গড়)")}</th>
                </tr>
              </thead>
              <tbody>
                {v.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product.name}{i.product.code && <span className="block text-xs text-slate-400">{i.product.code}</span>}</td>
                    {v.type === "STOCK_JOURNAL" && <td>{i.warehouse?.name}</td>}
                    {v.type === "STOCK_JOURNAL" && <td>{i.direction === 1 ? <Badge tone="green">{t("আগমন")}</Badge> : <Badge tone="red">{t("বাহির")}</Badge>}</td>}
                    <td className="num">{formatQty(num(i.quantity))} {i.unit?.name}{num(i.freeQuantity) > 0 && <span className="block text-[11px] font-semibold text-amber-800">+ {t("ফ্রি")} {formatQty(num(i.freeQuantity))}</span>}</td>
                    <td className="num">{formatMoney(num(i.rate), cur)}</td>
                    {trade && <td className="num">{num(i.discount) ? formatMoney(num(i.discount), cur) : ""}</td>}
                    {hasBatches && <td className="text-xs">{batchesOfItem(i, formatDate, formatQty)}</td>}
                    <td className="num font-semibold">{formatMoney(num(i.amount), cur)}</td>
                    <td className="num text-slate-500">{formatMoney(num(i.costAmount), cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </section>
      )}
    </>
  );
}

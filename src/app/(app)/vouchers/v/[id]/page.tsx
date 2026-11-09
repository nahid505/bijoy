import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { TRADE_TYPES, VOUCHER_TYPES } from "@/lib/accounting";
import { paymentStatus, PAYMENT_STATUS_LABELS, round2, round3 } from "@/lib/calc";
import { formatDate, formatDateTime, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { ActionButton } from "@/components/forms";
import { PaddySlip, toPaddySlipData } from "@/components/paddy-slip";
import { DepotChallan } from "@/components/depot-challan";
import { Badge, DetailRow, PageHeader, TableWrap } from "@/components/ui";
import { can, requireContext } from "@/server/auth";
import { batchesOfItem, loadVoucher } from "@/server/voucher-detail";
import { voucherAccess, voucherPermission } from "@/server/voucher-permissions";
import { deleteVoucherAction } from "@/server/actions/vouchers";
import { isPayrollVoucher } from "@/server/services/voucher";
import { DEPOT_ACCESS, isDepot } from "@/lib/depot";
import { canSeeVoucher } from "@/server/party-scope";
import { getT } from "@/server/i18n";
import { CollapsibleDeliveryInfo, CollapsibleJournal } from "./collapsible-journal";
import { VerificationBadge } from "@/components/verification-badge";

export const metadata: Metadata = { title: "ভাউচার" };

export default async function VoucherDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id === "new") redirect("/depot/deliveries/new");
  const ctx = await requireContext();
  const t = await getT();
  const v = await loadVoucher(ctx.business.id, id);
  if (!v) {
    const d = await prisma.depotDelivery.findFirst({
      where: { businessId: ctx.business.id, id },
      select: { voucherId: true },
    });
    if (d?.voucherId) {
      redirect(`/vouchers/v/${d.voucherId}`);
    }
    if (isDepot(ctx.business.businessType)) {
      redirect("/depot/deliveries");
    }
    redirect("/dashboard");
  }
  const isExpenseVoucher = v.type === "PAYMENT" && v.entries.some((e) => e.account.nature === "EXPENSE");
  const canViewVoucher = can(ctx, voucherAccess(v.type, "view", ctx.business.businessType, v.book)) ||
    (v.type === "OPENING" && can(ctx, "accounts:view")) ||
    (isExpenseVoucher && can(ctx, "expense:view"));

  if (!canViewVoucher) {
    if (isExpenseVoucher) {
      return (
        <div className="card mx-auto mt-16 max-w-lg p-10 text-center">
          <p className="text-5xl">💸</p>
          <p className="mt-3 font-mono text-sm font-bold tracking-wide text-credit">403 — Forbidden</p>
          <h1 className="mt-4 text-xl font-bold text-slate-800">প্রবেশাধিকার নেই</h1>
          <p className="mt-2 text-sm text-slate-500">এই খরচ এন্ট্রি বা দেখার আপনার অনুমতি নেই</p>
          <div className="mt-6 flex justify-center gap-2">
            <Link prefetch={false} href="/dashboard" className="btn-primary">ড্যাশবোর্ডে ফিরুন</Link>
          </div>
        </div>
      );
    }
    redirect("/forbidden");
  }
  if (!(await canSeeVoucher(ctx, v.id))) redirect("/forbidden"); // assigned-only roles: another party's voucher
  // opened through a depot permission only (depot-only role): the voucher, without the ledger postings
  const full = can(ctx, voucherPermission(v.type, "view")) || v.type === "OPENING" || (isExpenseVoucher && can(ctx, "expense:view"));
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
  const isDelivery = Boolean(v.depotDelivery || v.type === "DEPOT_DELIVERY");
  const canVerify = can(ctx, isDelivery ? ["can_verify_transactions", "depot_delivery_verify", "vouchers:verify"] : ["can_verify_transactions", "vouchers:verify"]);
  const canReject = can(ctx, ["can_reject_transactions", "vouchers:verify"]);
  const canUnverify = can(ctx, ["can_unverify_transactions", "vouchers:verify"]);
  const isVerified = (v.verificationStatus ?? "UNVERIFIED") === "VERIFIED";
  const isRejected = (v.verificationStatus ?? "UNVERIFIED") === "REJECTED";
  const isLocked = (isVerified || isRejected) && !canUnverify && !canVerify;
  // payroll vouchers are changed from the payroll module only
  const payrollHref = !payroll ? null : v.sourceKey!.startsWith("payroll:run:") ? `/payroll/runs/${v.sourceKey!.slice("payroll:run:".length)}` : v.sourceKey!.startsWith("payroll:advance:") ? "/payroll/advances" : "/payroll/payments";
  const hasBatches = v.items.some((i) => i.batchNo || i.stockMovements.length > 0);
  const party = v.partyAccount?.customer ?? v.partyAccount?.supplier;
  const partyHref = depotOnly ? null : v.partyAccount?.customer ? `/customers/${v.partyAccount.customer.id}` : v.partyAccount?.supplier ? `/suppliers/${v.partyAccount.supplier.id}` : v.partyAccount ? `/accounts/${v.partyAccountId}` : null;

  const totalDeliveryQty = round3(v.items.reduce((s, i) => s + num(i.quantity), 0));
  const totalFreeQty = round3(v.items.reduce((s, i) => s + num(i.freeQuantity), 0));
  const totalDeliveryValue = round2(v.items.reduce((s, i) => s + num(i.quantity) * num(i.challanRate ?? i.rate), 0));
  const totalCommissionValue = v.depotDelivery ? num(v.depotDelivery.commissionTotal) : round2(v.items.reduce((s, i) => s + num(i.amount), 0));

  const journalSection = full ? (
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
  ) : null;

  const voucherInfoSection = (
    <section className={depotOnly ? "panel lg:col-span-3" : "panel"}>
      <div className="panel-head"><h2 className="panel-title">{t("ভাউচার তথ্য")}</h2>{trade && <Badge tone={st === "PAID" ? "green" : st === "PARTIAL" ? "amber" : "red"}>{PAYMENT_STATUS_LABELS[st]}</Badge>}</div>
      <dl className="divide-y divide-rule px-4 py-1">
        <DetailRow label={t("ভাউচার নং")}>{v.voucherNo}</DetailRow>
        <DetailRow label={t("তারিখ")}>{formatDate(v.date)}</DetailRow>
        {v.partyAccount && <DetailRow label={t("পার্টি / হিসাব")}>{partyHref ? <Link prefetch={false} href={partyHref} className="text-brand-700 hover:underline">{v.partyAccount.name}</Link> : v.partyAccount.name}{party?.mobile ? ` (${party.mobile})` : ""}</DetailRow>}
        {v.payments.length > 0
          ? v.payments.map((pm) => <DetailRow key={pm.id} label={`পেমেন্ট: ${pm.account.name}`}>{formatMoney(num(pm.amount), cur)}{pm.reference ? ` (${pm.reference})` : ""}</DetailRow>)
          : v.cashAccount && !trade && <DetailRow label={t("নগদ/ব্যাংক")}>{v.cashAccount.name}</DetailRow>}
        {v.dueDate && <DetailRow label={t("পরিশোধের শেষ তারিখ")}>{formatDate(v.dueDate)}</DetailRow>}
        {v.returnOf && <DetailRow label={t("মূল ইনভয়েস")}><Link prefetch={false} href={`/vouchers/v/${v.returnOf.id}`} className="text-brand-700 hover:underline">{v.returnOf.voucherNo}</Link></DetailRow>}
        {v.returns.map((r) => <DetailRow key={r.id} label={t("ফেরত")}><Link prefetch={false} href={`/vouchers/v/${r.id}`} className="text-brand-700 hover:underline">{r.voucherNo}</Link> · {formatMoney(num(r.amount), cur)}</DetailRow>)}
        {v.warehouse && <DetailRow label={t("গুদাম")}>{v.warehouse.name}</DetailRow>}
        {v.reference && <DetailRow label={t("রেফারেন্স")}>{v.reference}</DetailRow>}
        {v.destination && <DetailRow label={t("গন্তব্য / রুট")}>{v.destination}</DetailRow>}
        {v.vehicleNo && <DetailRow label={t("গাড়ির নম্বর")}>{v.vehicleNo}</DetailRow>}
        {v.driverName && <DetailRow label={t("ড্রাইভার")}>{v.driverName}{v.driverMobile ? ` (${v.driverMobile})` : ""}</DetailRow>}
        {num(v.transportFare) > 0 && <DetailRow label={t("পরিবহন ভাড়া")}>{formatMoney(num(v.transportFare), cur)}</DetailRow>}
        {trade && <DetailRow label={t("উপমোট")}>{formatMoney(num(v.subtotal), cur)}</DetailRow>}
        {trade && num(v.discount) > 0 && <DetailRow label={t("ছাড়")}>{formatMoney(num(v.discount), cur)}</DetailRow>}
        {trade && num(v.vatAmount) > 0 && <DetailRow label={`ভ্যাট (${formatQty(num(v.vatPercent))}%)`}>{formatMoney(num(v.vatAmount), cur)}</DetailRow>}
        <DetailRow label={t("মোট টাকা")}>{formatMoney(amount, cur)}</DetailRow>
        {trade && <DetailRow label={t("নগদে লেনদেন")}>{formatMoney(paid, cur)}</DetailRow>}
        {trade && <DetailRow label={t("বাকি")}><span className={amount - paid > 0 ? "text-credit" : ""}>{formatMoney(amount - paid, cur)}</span></DetailRow>}
        {v.narration && v.narration !== v.paddyPurchase?.notes && <DetailRow label={t("বিবরণ")}>{v.narration}</DetailRow>}
        <DetailRow label={t("যাচাই অবস্থা")}>
          <VerificationBadge
            voucherId={v.id}
            status={v.verificationStatus}
            verifiedBy={v.verifiedBy?.name}
            verifiedAt={v.verifiedAt}
            verificationNote={v.verificationNote}
            canVerify={canVerify}
            canReject={canReject}
            canUnverify={canUnverify}
          />
        </DetailRow>
        <DetailRow label={t("তৈরি")}>{v.createdBy.name} · {formatDateTime(v.createdAt)}</DetailRow>
        {v.updatedBy && <DetailRow label={t("সর্বশেষ সম্পাদনা")}>{v.updatedBy.name} · {formatDateTime(v.updatedAt)}</DetailRow>}
      </dl>
    </section>
  );

  const accountingGrid = (
    <div className="grid gap-4 lg:grid-cols-3">
      {journalSection}
      {voucherInfoSection}
    </div>
  );

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
                {can(ctx, DEPOT_ACCESS.deliveryCreate) && (
                  <Link prefetch={false} href="/depot/deliveries/new" className="btn-secondary">{t("+ নতুন চালান")}</Link>
                )}
                {editable && !isLocked && can(ctx, voucherAccess(v.type, "edit", ctx.business.businessType, v.book)) && (
                  <Link prefetch={false} href={`/depot/deliveries/${v.id}/edit`} className="btn-secondary">{t("সম্পাদনা")}</Link>
                )}
                <Link prefetch={false} href="/dashboard" className="btn-secondary" title={t("ড্যাশবোর্ডে ফিরে যান")}>{t("ড্যাশবোর্ড")}</Link>
              </>
            ) : (
              <Link prefetch={false} href={`/vouchers/v/${v.id}/print`} className="btn-primary">{t(v.type === "SALES" ? "🧾 ইনভয়েস / প্রিন্ট" : "🖨 প্রিন্ট / PDF")}</Link>
            )}
            {!v.depotDelivery && v.type === "SALES" && can(ctx, "sales:create") && <Link prefetch={false} href={`/vouchers/sales-return/new?from=${v.id}`} className="btn-secondary">{t("↩ ফেরত নিন")}</Link>}
            {!v.depotDelivery && v.type === "PURCHASE" && can(ctx, "purchases:create") && <Link prefetch={false} href={`/vouchers/purchase-return/new?from=${v.id}`} className="btn-secondary">{t("↩ ফেরত দিন")}</Link>}
            {!v.depotDelivery && v.type === "SALES" && v.partyAccountId && amount - paid > 0 && can(ctx, v.book === "DEPOT" ? DEPOT_ACCESS.collection : "vouchers:create") && <Link prefetch={false} href={v.book === "DEPOT" ? `/depot/collections/new?party=${v.partyAccountId}` : `/vouchers/receipt/new?party=${v.partyAccountId}`} className="btn-secondary">{t("বাকি আদায়")}</Link>}
            {payrollHref && can(ctx, "payroll:view") && <Link prefetch={false} href={payrollHref} className="btn-secondary">{t("বেতন মডিউলে দেখুন")}</Link>}
            {isLocked ? (
              <span className="btn-secondary opacity-80 cursor-not-allowed flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 border-amber-300 font-medium" title={isRejected ? t("লেনদেনটি বাতিলকৃত ও লক করা — শুধুমাত্র ভেরিফায়ার আনলক বা সম্পাদনা করতে পারবেন") : t("লেনদেনটি অনুমোদিত ও লক করা — শুধুমাত্র ভেরিফায়ার আনলক বা সম্পাদনা করতে পারবেন")}>
                <span>🔒</span>
                <span>{isRejected ? t("বাতিল ও লক") : t("অনুমোদিত ও লক")}</span>
              </span>
            ) : (
              <>
                {!v.depotDelivery && editable && (can(ctx, voucherAccess(v.type, "edit", ctx.business.businessType, v.book)) || (isExpenseVoucher && can(ctx, "expense:edit"))) && <Link prefetch={false} href={v.type === "PRODUCTION" ? `/production/${v.id}/edit` : v.paddyPurchase ? `/purchases/paddy/${v.id}/edit` : `/vouchers/v/${v.id}/edit`} className="btn-secondary">{t("সম্পাদনা")}</Link>}
                {editable && (can(ctx, voucherAccess(v.type, "delete", ctx.business.businessType, v.book)) || (isExpenseVoucher && can(ctx, "expense:delete"))) && (
                  <ActionButton action={deleteVoucherAction.bind(null, v.id)} label={t("মুছুন")} className="btn-danger" confirmText={t("ভাউচারটি মুছে ফেললে সংশ্লিষ্ট সব জার্নাল এন্ট্রি ও স্টক মুভমেন্ট বাতিল হবে। নিশ্চিত?")} />
                )}
              </>
            )}
          </>
        }
      />

      {/* ── Enterprise Verification Banner ── */}
      <div className={`mb-4 p-3.5 sm:p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 shadow-xs ${
        isVerified
          ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
          : v.verificationStatus === "REJECTED"
          ? "bg-rose-50/70 border-rose-200 text-rose-950"
          : "bg-slate-50 border-slate-200 text-slate-800"
      }`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-2xl shrink-0">
            {isVerified ? "🛡️" : v.verificationStatus === "REJECTED" ? "✕" : "⏳"}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm sm:text-base">
                {isVerified
                  ? t("লেনদেনটি যাচাই ও অনুমোদিত (Verified)")
                  : v.verificationStatus === "REJECTED"
                  ? t("লেনদেনটি বাতিলকৃত (Rejected)")
                  : t("লেনদেনটি এখনো অপেক্ষমাণ (Pending Verification)")}
              </span>
              {isVerified && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-200/70 text-emerald-900 px-2 py-0.5 rounded-full">
                  <span>🔒</span>
                  <span>{t("লক করা")}</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              {isVerified ? (
                <>
                  {t("যাচাই করেছেন")}: <b className="text-slate-800">{v.verifiedBy?.name ?? t("অনুমোদনকারী")}</b>
                  {v.verifiedAt && <> · {formatDateTime(v.verifiedAt)}</>}
                  {v.verificationNote && <span className="block text-amber-800 font-medium mt-0.5">মন্তব্য: {v.verificationNote}</span>}
                </>
              ) : v.verificationStatus === "REJECTED" ? (
                <>
                  {t("বাতিল করেছেন")}: <b className="text-slate-800">{v.verifiedBy?.name ?? t("ভেরিফায়ার")}</b>
                  {v.verifiedAt && <> · {formatDateTime(v.verifiedAt)}</>}
                  {v.verificationNote && <span className="block text-rose-700 font-medium mt-0.5">কারণ: {v.verificationNote}</span>}
                </>
              ) : (
                t("মালিক বা অনুমোদিত ভেরিফায়ার দ্বারা এখনো লেনদেনটি যাচাই করা হয়নি।")
              )}
            </p>
          </div>
        </div>

        <div>
          <VerificationBadge
            voucherId={v.id}
            status={v.verificationStatus || "UNVERIFIED"}
            verifiedBy={v.verifiedBy?.name}
            verifiedAt={v.verifiedAt}
            verificationNote={v.verificationNote}
            canVerify={canVerify}
            canReject={canReject}
            canUnverify={canUnverify}
          />
        </div>
      </div>

      {isDelivery ? (
        <>
          {v.items.length > 0 && (
            <section className="panel mb-4">
              <div className="panel-head">
                <h2 className="panel-title">{t("পণ্যের বিবরণ")}</h2>
              </div>
              <TableWrap>
                <table className="table" id="challan-products-table">
                  <thead>
                    <tr>
                      <th className="w-12 text-center">{t("ক্রমিক নং")}</th>
                      <th>{t("পণ্যের নাম ও কোড")}</th>
                      <th className="num">{t("মূল পরিমাণ")}</th>
                      <th className="num">{t("ফ্রি পরিমাণ")}</th>
                      <th className="num">{t("দর / রেট")}</th>
                      <th className="num">{t("মোট টাকা")}</th>
                      <th className="num">{t("কমিশন হার")}</th>
                      <th className="num">{t("মোট কমিশন")}</th>
                      <th>{t("ব্যাচ / মেয়াদ")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.items.map((i, idx) => {
                      const lineRate = num(i.challanRate ?? i.rate);
                      const lineTotal = round2(num(i.quantity) * lineRate);
                      const lineCommission = round2(num(i.amount));
                      const isPercentComm = i.product.depotCommissionType === "PERCENT" && num(i.product.depotCommissionRate) > 0;
                      return (
                        <tr key={i.id}>
                          <td className="text-center tabular-nums text-slate-500">{toBnDigits(idx + 1)}</td>
                          <td>
                            <span className="font-semibold text-slate-900">{i.product.name}</span>
                            {i.product.code && <span className="block text-xs font-normal text-slate-500">{i.product.code}</span>}
                          </td>
                          <td className="num font-medium text-slate-900">
                            {formatQty(num(i.quantity))} <span className="text-xs font-normal text-slate-500">{i.unit?.name}</span>
                          </td>
                          <td className="num">
                            {num(i.freeQuantity) > 0 ? (
                              <span className="font-medium text-amber-800">
                                {formatQty(num(i.freeQuantity))} <span className="text-xs font-normal text-amber-700">{i.unit?.name}</span>
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="num font-medium text-slate-700">{formatMoney(lineRate, cur)}</td>
                          <td className="num font-semibold text-slate-900">{formatMoney(lineTotal, cur)}</td>
                          <td className="num text-slate-700">
                            {v.depotDelivery?.mode === "COMPANY_PAID" ? (
                              isPercentComm ? (
                                <span>
                                  {formatQty(num(i.product.depotCommissionRate))}%
                                  <span className="block text-xs font-normal text-slate-500">({formatMoney(num(i.rate), cur)})</span>
                                </span>
                              ) : (
                                <span>
                                  {formatMoney(num(i.rate), cur)}
                                  {i.unit?.name && <span className="block text-xs font-normal text-slate-500">/ {i.unit.name}</span>}
                                </span>
                              )
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="num font-semibold text-brand-700">
                            {v.depotDelivery?.mode === "COMPANY_PAID" ? formatMoney(lineCommission, cur) : <span className="text-slate-400 font-normal">—</span>}
                          </td>
                          <td className="text-xs text-slate-600">
                            {batchesOfItem(i, formatDate, formatQty) || i.batchNo || <span className="text-slate-400">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-300 bg-slate-50/70 font-bold text-slate-900">
                      <td colSpan={2} className="px-3 py-2.5">
                        {t("সর্বমোট ({0} টি পণ্য)", { "0": toBnDigits(v.items.length) })}
                      </td>
                      <td className="num px-3 py-2.5 font-bold">
                        {formatQty(totalDeliveryQty)}
                      </td>
                      <td className="num px-3 py-2.5 text-amber-800 font-bold">
                        {totalFreeQty > 0 ? formatQty(totalFreeQty) : <span className="font-normal text-slate-400">—</span>}
                      </td>
                      <td className="num px-3 py-2.5"></td>
                      <td className="num px-3 py-2.5 font-bold text-slate-900">
                        {formatMoney(totalDeliveryValue, cur)}
                      </td>
                      <td className="num px-3 py-2.5"></td>
                      <td className="num px-3 py-2.5 font-bold text-brand-700">
                        {v.depotDelivery?.mode === "COMPANY_PAID" ? formatMoney(totalCommissionValue, cur) : <span className="font-normal text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5"></td>
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            </section>
          )}

          {v.depotDelivery && (
            <CollapsibleDeliveryInfo
              title={v.depotDelivery.mode === "COMPANY_PAID" ? "Company Paid (DO Release) তথ্য দেখুন" : "Market Sales (মার্কেট সেলস) তথ্য দেখুন"}
              titleHide={v.depotDelivery.mode === "COMPANY_PAID" ? "Company Paid (DO Release) তথ্য লুকান" : "Market Sales (মার্কেট সেলস) তথ্য লুকান"}
            >
              <div className="panel px-4">
                <DepotChallan
                  currency={cur}
                  d={{
                    mode: v.depotDelivery.mode,
                    doNumber: v.depotDelivery.doNumber,
                    company: v.depotDelivery.companyAccount?.name ?? null,
                    dealer: v.depotDelivery.dealerAccount?.name ?? null,
                    route: v.depotDelivery.dealerAccount?.customer?.route ?? null,
                    dealerMobile: v.depotDelivery.dealerAccount?.customer?.mobile ?? null,
                    vehicleNo: v.depotDelivery.vehicleNo,
                    driverName: v.depotDelivery.driverName,
                    commission: num(v.depotDelivery.commissionTotal),
                    notes: v.depotDelivery.notes,
                  }}
                />
              </div>
            </CollapsibleDeliveryInfo>
          )}

          <CollapsibleJournal badge={full ? <Badge tone={dr === cr ? "green" : "red"}>{dr === cr ? t("ডেবিট = ক্রেডিট ✔") : t("অসমতা!")}</Badge> : undefined}>
            {accountingGrid}
          </CollapsibleJournal>
        </>
      ) : (
        <>
          {v.paddyPurchase && (
            <div className="panel mb-4 px-4">
              <PaddySlip currency={cur} d={toPaddySlipData(v.paddyPurchase)} />
            </div>
          )}

          {v.items.length > 0 && (
            <section className="panel mb-4">
              <div className="panel-head">
                <h2 className="panel-title">{t("পণ্যের বিবরণ")}</h2>
              </div>
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
                        <td>
                          <span className="font-semibold text-slate-900">{i.product.name}</span>
                          {i.product.code && <span className="block text-xs font-normal text-slate-500">{i.product.code}</span>}
                        </td>
                        {v.type === "STOCK_JOURNAL" && <td>{i.warehouse?.name}</td>}
                        {v.type === "STOCK_JOURNAL" && <td>{i.direction === 1 ? <Badge tone="green">{t("আগমন")}</Badge> : <Badge tone="red">{t("বাহির")}</Badge>}</td>}
                        <td className="num font-medium text-slate-900">
                          {formatQty(num(i.quantity))} <span className="text-xs font-normal text-slate-500">{i.unit?.name}</span>
                          {num(i.freeQuantity) > 0 && <span className="block text-[11px] font-semibold text-amber-800">+ {t("ফ্রি")} {formatQty(num(i.freeQuantity))}</span>}
                        </td>
                        <td className="num font-medium text-slate-700">{formatMoney(num(i.rate), cur)}</td>
                        {trade && <td className="num">{num(i.discount) ? formatMoney(num(i.discount), cur) : <span className="text-slate-400 font-normal">—</span>}</td>}
                        {hasBatches && <td className="text-xs text-slate-600">{batchesOfItem(i, formatDate, formatQty) || <span className="text-slate-400 font-normal">—</span>}</td>}
                        <td className="num font-semibold text-slate-900">{formatMoney(num(i.amount), cur)}</td>
                        <td className="num text-slate-500">{formatMoney(num(i.costAmount), cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                  {trade && (
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50/70 font-bold text-slate-900">
                        <td colSpan={2} className="px-3 py-2.5">
                          {t("সর্বমোট ({0} টি পণ্য)", { "0": toBnDigits(v.items.length) })}
                        </td>
                        <td className="num px-3 py-2.5 font-bold">
                          {formatQty(round3(v.items.reduce((s, i) => s + num(i.quantity), 0)))}
                        </td>
                        <td className="num px-3 py-2.5"></td>
                        <td className="num px-3 py-2.5">{num(v.discount) > 0 ? formatMoney(num(v.discount), cur) : ""}</td>
                        {hasBatches && <td></td>}
                        <td className="num px-3 py-2.5 font-bold text-slate-900">
                          {formatMoney(amount, cur)}
                        </td>
                        <td className="num px-3 py-2.5"></td>
                      </tr>
                      {(paid > 0 || amount - paid > 0) && (
                        <tr className="border-t border-slate-200 bg-slate-50/50 text-xs">
                          <td colSpan={trade ? 5 : 4} className="px-3 py-2 text-right text-slate-600">
                            <span>{t("পরিশোধ (নগদ/ব্যাংক)")}: <strong className="text-emerald-700 font-bold">{formatMoney(paid, cur)}</strong></span>
                            {amount - paid > 0 && (
                              <span className="ml-4">{t("বাকি")}: <strong className="text-credit font-bold">{formatMoney(amount - paid, cur)}</strong></span>
                            )}
                          </td>
                          <td colSpan={hasBatches ? 3 : 2}></td>
                        </tr>
                      )}
                    </tfoot>
                  )}
                </table>
              </TableWrap>
            </section>
          )}

          <CollapsibleJournal
            badge={full ? <Badge tone={dr === cr ? "green" : "red"}>{dr === cr ? t("ডেবিট = ক্রেডিট ✔") : t("অসমতা!")}</Badge> : undefined}
            defaultOpen={v.items.length === 0 && !v.paddyPurchase}
          >
            {accountingGrid}
          </CollapsibleJournal>
        </>
      )}
    </>
  );
}

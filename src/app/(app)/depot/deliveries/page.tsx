import type { Metadata } from "next";
import Link from "next/link";
import { num } from "@/lib/db";
import { DEPOT_ACCESS, DEPOT_MODE_SHORT, type DepotMode, isDepot } from "@/lib/depot";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { AutoPrint } from "@/components/forms";
import { buildQuery, EmptyState, FilterBar, FilterField, PageHeader, Pagination, PrintHeader, StatCard, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { listDepotDeliveries } from "@/server/services/depot";
import { DepotOnlyNotice, ModeBadge } from "../depot-ui";
import { voucherScopeWhere } from "@/server/party-scope";

import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "ডেলিভারি চালান" };
const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : undefined);

// ?print=1 renders every challan matching the filters (no pagination) as a clean A4 sheet and opens the print dialog.
export default async function DepotDeliveriesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(DEPOT_ACCESS.view);
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  const t = await getT();
  const cur = ctx.business.currencySymbol;
  const money = (n: number) => formatMoney(n, cur);
  const p = await readParams(searchParams);
  const printing = p.print === "1";
  const page = pageOf(p);
  const mode = p.mode === "COMPANY_PAID" || p.mode === "DEPOT_COLLECTION" ? (p.mode as DepotMode) : undefined;
  const from = day(p.from) ? p.from : undefined;
  const to = day(p.to) ? p.to : undefined;
  const q = p.q?.trim() || undefined;
  const { rows, total, totals } = await listDepotDeliveries(ctx.business.id, {
    from: day(from),
    to: day(to),
    mode,
    q,
    scope: voucherScopeWhere(ctx),
    ...(printing ? {} : { skip: page.skip, take: page.take }),
  });
  const filters = { from, to, mode, q };
  const exportHref = `/api/reports/depot-deliveries${buildQuery(filters, { all: from || to ? undefined : "1", format: "xlsx" })}`;
  const filterText = [from || to ? `${from ? formatDate(from) : t("শুরু")} — ${to ? formatDate(to) : t("আজ")}` : t("সব তারিখ"), mode ? t(DEPOT_MODE_SHORT[mode]) : "", q ? `${t("খোঁজ:")} ${q}` : ""].filter(Boolean).join(" · ");
  const pageQty = rows.reduce((s, r) => s + r.quantity, 0);
  const pageFree = rows.reduce((s, r) => s + r.free, 0);
  const pageSale = rows.reduce((s, r) => s + r.saleValue, 0);
  const pageCommission = rows.reduce((s, r) => s + num(r.commissionTotal), 0);
  const paged = !printing && total > rows.length;

  return (
    <>
      {printing && <AutoPrint />}
      <div className="no-print">
        <PageHeader
          title="ডেলিভারি চালান"
          description="কোম্পানি পেইড (ডিও রিলিজ) ও ডিপো কালেকশন (মার্কেট সেলস) — সব ডেলিভারি এক জায়গায়"
          crumbs={[{ label: "ডিপো ব্যবস্থাপনা" }, { label: "ডেলিভারি চালান" }]}
          actions={
            printing ? (
              <Link prefetch={false} href={`/depot/deliveries${buildQuery(filters)}`} className="btn-secondary">{t("← তালিকায় ফিরুন")}</Link>
            ) : (
              <>
                <Link prefetch={false} href={`/depot/deliveries${buildQuery(filters, { print: "1" })}`} className="btn-secondary" id="print-list">🖨 {t("প্রিন্ট / PDF")}</Link>
                {can(ctx, DEPOT_ACCESS.register) && <a href={exportHref} className="btn-secondary" id="export-xlsx">⬇ {t("Excel (XLSX)")}</a>}
                {can(ctx, DEPOT_ACCESS.deliveryCreate) && <Link prefetch={false} href="/depot/deliveries/new" className="btn-primary">+ {t("ডেলিভারি চালান তৈরি")}</Link>}
              </>
            )
          }
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-3" id="delivery-cards">
          <StatCard label="মোট চালান" value={toBnDigits(total)} hint={`${t("ডিও রিলিজ")} ${toBnDigits(totals.doCount)} · ${t("মার্কেট সেলস")} ${toBnDigits(totals.marketCount)}`} />
          <StatCard label="মোট বিক্রয় মূল্য" value={money(totals.saleValue)} tone="green" hint="সরবরাহ পরিমাণ × দর — সব চালান" />
          <StatCard label="মোট কমিশন" value={money(totals.commission)} tone="blue" hint="ডিও রিলিজ থেকে অর্জিত" />
        </div>
      </div>
      <section className="panel print-area">
        {!printing && (
          <FilterBar action="/depot/deliveries">
            <FilterField label="তারিখ থেকে"><input type="date" name="from" defaultValue={from ?? ""} className="input w-40" /></FilterField>
            <FilterField label="পর্যন্ত"><input type="date" name="to" defaultValue={to ?? ""} className="input w-40" /></FilterField>
            <FilterField label="ধরন">
              <select name="mode" defaultValue={mode ?? ""} className="input w-44">
                <option value="">{t("সব")}</option>
                <option value="COMPANY_PAID">{t("কোম্পানি পেইড (ডিও)")}</option>
                <option value="DEPOT_COLLECTION">{t("মার্কেট সেলস")}</option>
              </select>
            </FilterField>
            <FilterField label="খুঁজুন"><input name="q" defaultValue={q ?? ""} placeholder={t("চালান/ডিও নং, ডিলার, কোম্পানি")} className="input w-56" /></FilterField>
          </FilterBar>
        )}
        <div className={printing ? "p-4" : undefined}>
          {printing && <PrintHeader business={ctx.business} title={t("ডেলিভারি চালান তালিকা")} subtitle={filterText} />}
          {printing && <p className="no-print mb-3 text-sm text-slate-600">{filterText} — {t("মোট")} {toBnDigits(total)} {t("টি চালান")}</p>}
          {rows.length === 0 ? <EmptyState message="এখনও কোনো ডেলিভারি চালান নেই" /> : (
            <TableWrap>
              <table className="table print:text-[10px]" id="delivery-list">
                <thead><tr>{printing && <th>{t("ক্রমিক")}</th>}<th>{t("নং / তারিখ")}</th><th>{t("ধরন")}</th><th>{t("ডিও / রেফ.")}</th><th>{t("কোম্পানি")}</th><th>{t("ডিলার (রুট)")}</th><th className="text-right">{t("পরিমাণ")}</th><th className="text-right">{t("ফ্রি")}</th><th className="text-right">{t("বিক্রয় মূল্য")}</th><th className="text-right">{t("কমিশন")}</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const unit = r.voucher.items[0]?.product.unit.name ?? "";
                    return (
                      <tr key={r.id}>
                        {printing && <td className="text-sm tabular-nums">{toBnDigits(i + 1)}</td>}
                        <td><Link prefetch={false} href={`/vouchers/v/${r.voucher.id}`} className="font-semibold text-brand-700 hover:underline">{r.voucher.voucherNo}</Link><span className="block text-xs text-slate-500">{formatDate(r.voucher.date)}</span></td>
                        <td><ModeBadge mode={r.mode} /></td>
                        <td className="text-sm">{r.doNumber ?? "—"}</td>
                        <td className="text-sm">{r.companyAccount?.name ?? "—"}</td>
                        <td className="text-sm">{r.dealerAccount?.name ?? t("নগদ বিক্রয়")}{r.dealerAccount?.customer?.route && <span className="block text-xs text-slate-500">{r.dealerAccount.customer.route}</span>}</td>
                        <td className="num">{formatQty(r.quantity)} {r.voucher.items.length === 1 ? unit : ""}</td>
                        <td className="num text-amber-800">{r.free ? formatQty(r.free) : "—"}</td>
                        <td className="num font-semibold" data-sale>{money(r.saleValue)}</td>
                        <td className="num">{r.mode === "COMPANY_PAID" ? money(num(r.commissionTotal)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {paged && (
                    <tr className="text-slate-600">
                      <td colSpan={5}>{t("এই পাতার মোট")}</td>
                      <td className="num">{formatQty(pageQty)}</td>
                      <td className="num">{pageFree ? formatQty(pageFree) : "—"}</td>
                      <td className="num">{money(pageSale)}</td>
                      <td className="num">{money(pageCommission)}</td>
                    </tr>
                  )}
                  <tr className="font-bold" id="delivery-total">
                    <td colSpan={printing ? 6 : 5}>{t("সর্বমোট ({0} টি চালান)", { "0": toBnDigits(total) })}</td>
                    <td className="num">{paged ? "" : formatQty(pageQty)}</td>
                    <td className="num">{paged ? "" : pageFree ? formatQty(pageFree) : "—"}</td>
                    <td className="num" id="total-sale">{money(totals.saleValue)}</td>
                    <td className="num" id="total-commission">{money(totals.commission)}</td>
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          )}
          {printing && rows.length > 0 && (
            <p className="mt-3 text-sm">
              {t("মোট বিক্রয় মূল্য:")} <b>{money(totals.saleValue)}</b> · {t("মোট কমিশন:")} <b>{money(totals.commission)}</b> · {t("ডিও রিলিজ")} {toBnDigits(totals.doCount)} {t("টি")} · {t("মার্কেট সেলস")} {toBnDigits(totals.marketCount)} {t("টি")}
            </p>
          )}
        </div>
        {!printing && <Pagination basePath="/depot/deliveries" params={p} page={page.page} totalPages={totalPages(total)} total={total} />}
      </section>
    </>
  );
}

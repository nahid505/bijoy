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

export const metadata: Metadata = { title: "ডেলিভারি চালান" };
const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : undefined);

// ?print=1 renders every challan matching the filters (no pagination) as a clean A4 sheet and opens the print dialog.
export default async function DepotDeliveriesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(DEPOT_ACCESS.view);
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
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
  const filterText = [from || to ? `${from ? formatDate(from) : "শুরু"} — ${to ? formatDate(to) : "আজ"}` : "সব তারিখ", mode ? DEPOT_MODE_SHORT[mode] : "", q ? `খোঁজ: ${q}` : ""].filter(Boolean).join(" · ");
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
              <Link prefetch={false} href={`/depot/deliveries${buildQuery(filters)}`} className="btn-secondary">← তালিকায় ফিরুন</Link>
            ) : (
              <>
                <Link prefetch={false} href={`/depot/deliveries${buildQuery(filters, { print: "1" })}`} className="btn-secondary" id="print-list">🖨 প্রিন্ট / PDF</Link>
                {can(ctx, DEPOT_ACCESS.register) && <a href={exportHref} className="btn-secondary" id="export-xlsx">⬇ Excel (XLSX)</a>}
                {can(ctx, DEPOT_ACCESS.deliveryCreate) && <Link prefetch={false} href="/depot/deliveries/new" className="btn-primary">+ ডেলিভারি চালান তৈরি</Link>}
              </>
            )
          }
        />
        <div className="mb-4 grid gap-3 sm:grid-cols-3" id="delivery-cards">
          <StatCard label="মোট চালান" value={toBnDigits(total)} hint={`ডিও রিলিজ ${toBnDigits(totals.doCount)} · মার্কেট সেলস ${toBnDigits(totals.marketCount)}`} />
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
                <option value="">সব</option>
                <option value="COMPANY_PAID">কোম্পানি পেইড (ডিও)</option>
                <option value="DEPOT_COLLECTION">মার্কেট সেলস</option>
              </select>
            </FilterField>
            <FilterField label="খুঁজুন"><input name="q" defaultValue={q ?? ""} placeholder="চালান/ডিও নং, ডিলার, কোম্পানি" className="input w-56" /></FilterField>
          </FilterBar>
        )}
        <div className={printing ? "p-4" : undefined}>
          {printing && <PrintHeader business={ctx.business} title="ডেলিভারি চালান তালিকা" subtitle={filterText} />}
          {printing && <p className="no-print mb-3 text-sm text-slate-600">{filterText} — মোট {toBnDigits(total)} টি চালান</p>}
          {rows.length === 0 ? <EmptyState message="এখনও কোনো ডেলিভারি চালান নেই" /> : (
            <TableWrap>
              <table className="table print:text-[10px]" id="delivery-list">
                <thead><tr>{printing && <th>ক্রমিক</th>}<th>নং / তারিখ</th><th>ধরন</th><th>ডিও / রেফ.</th><th>কোম্পানি</th><th>ডিলার (রুট)</th><th className="text-right">পরিমাণ</th><th className="text-right">ফ্রি</th><th className="text-right">বিক্রয় মূল্য</th><th className="text-right">কমিশন</th></tr></thead>
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
                        <td className="text-sm">{r.dealerAccount?.name ?? "নগদ বিক্রয়"}{r.dealerAccount?.customer?.route && <span className="block text-xs text-slate-500">{r.dealerAccount.customer.route}</span>}</td>
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
                      <td colSpan={5}>এই পাতার মোট</td>
                      <td className="num">{formatQty(pageQty)}</td>
                      <td className="num">{pageFree ? formatQty(pageFree) : "—"}</td>
                      <td className="num">{money(pageSale)}</td>
                      <td className="num">{money(pageCommission)}</td>
                    </tr>
                  )}
                  <tr className="font-bold" id="delivery-total">
                    <td colSpan={printing ? 6 : 5}>সর্বমোট ({toBnDigits(total)} টি চালান)</td>
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
              মোট বিক্রয় মূল্য: <b>{money(totals.saleValue)}</b> · মোট কমিশন: <b>{money(totals.commission)}</b> · ডিও রিলিজ {toBnDigits(totals.doCount)} টি · মার্কেট সেলস {toBnDigits(totals.marketCount)} টি
            </p>
          )}
        </div>
        {!printing && <Pagination basePath="/depot/deliveries" params={p} page={page.page} totalPages={totalPages(total)} total={total} />}
      </section>
    </>
  );
}

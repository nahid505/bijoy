import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { ci } from "@/lib/dialect";
import { commissionText, DEPOT_ACCESS, isDepot } from "@/lib/depot";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { AutoPrint } from "@/components/forms";
import { Badge, buildQuery, EmptyState, FilterBar, FilterField, PageHeader, Pagination, PrintHeader, StatCard, TableWrap } from "@/components/ui";
import { getT } from "@/server/i18n";
import { can, requirePermission } from "@/server/auth";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { DepotOnlyNotice } from "../depot-ui";
import { digitVariants, toAsciiDigits } from "@/lib/digits";
import { DepotProductsPrintButton } from "./print-button";

export const metadata: Metadata = { title: "ডিপো পণ্য তালিকা" };

/** "গ্রুপ ছাড়া" in the group filter: products without a category */
const NO_GROUP = "none";

/**
 * Depot (dealership) products only — the general products are on /products.
 *   ?group=<category id> | none   one product group (category), or the products without one
 *   ?view=grouped                 products under their group's heading, with stock and value subtotals per group
 *   ?print=1                      every product matching the filters (no pagination) as an A4 sheet; prints itself
 */
export default async function DepotProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(DEPOT_ACCESS.productsView);
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  const t = await getT();
  const p = await readParams(searchParams);
  const printing = p.print === "1";
  const grouped = p.view === "grouped";
  const { page, skip, take } = pageOf(p);
  const cur = ctx.business.currencySymbol;
  const money = (n: number) => formatMoney(n, cur);
  const businessId = ctx.business.id;
  const q = p.q?.trim();
  const group = p.group || undefined;
  const where: Prisma.ProductWhereInput = {
    businessId,
    isDepotProduct: true,
    ...(q ? { OR: [...digitVariants(q).map((v) => ({ name: ci(v) })), { code: ci(toAsciiDigits(q)) }, { barcode: { contains: toAsciiDigits(q) } }] } : {}),
    ...(p.brand ? { brandId: p.brand } : {}),
    ...(group === NO_GROUP ? { categoryId: null } : group ? { categoryId: group } : {}),
    ...(p.status === "inactive" ? { isActive: false } : p.status === "all" ? {} : { isActive: true }),
  };
  // the grouped view and the printout show every matching product; the plain list is paged
  const everything = grouped || printing;
  const [rows, total, brands, groups, all] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: grouped ? [{ category: { name: "asc" } }, { name: "asc" }] : [{ brand: { name: "asc" } }, { name: "asc" }],
      ...(everything ? {} : { skip, take }),
      include: { unit: { select: { name: true } }, brand: { select: { name: true } }, category: { select: { id: true, name: true } } },
    }),
    prisma.product.count({ where }),
    prisma.brand.findMany({ where: { businessId, products: { some: { isDepotProduct: true } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { businessId, products: { some: { isDepotProduct: true } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { businessId, isDepotProduct: true, isActive: true }, select: { stock: true, avgCost: true } }),
  ]);
  const stockValue = round2(all.reduce((s, r) => s + num(r.stock) * num(r.avgCost), 0));
  const canManage = can(ctx, DEPOT_ACCESS.products);

  type Row = (typeof rows)[number];
  const valueOf = (r: Row) => round2(num(r.stock) * num(r.avgCost));
  // grouped view: the groups in name order, the products without one last
  const sections: { key: string; name: string; rows: Row[] }[] = [];
  if (grouped) {
    const byKey = new Map<string, { key: string; name: string; rows: Row[] }>();
    for (const r of rows) {
      const key = r.category?.id ?? NO_GROUP;
      if (!byKey.has(key)) byKey.set(key, { key, name: r.category?.name ?? t("গ্রুপ ছাড়া"), rows: [] });
      byKey.get(key)!.rows.push(r);
    }
    sections.push(...[...byKey.values()].filter((s) => s.key !== NO_GROUP), ...(byKey.has(NO_GROUP) ? [byKey.get(NO_GROUP)!] : []));
  }
  // stock of mixed units is not added up: "১২০ কার্টন · ৪০ পিস"
  const stockText = (list: Row[]) => {
    const perUnit = new Map<string, number>();
    for (const r of list) perUnit.set(r.unit.name, (perUnit.get(r.unit.name) ?? 0) + num(r.stock));
    return [...perUnit].map(([u, n]) => `${formatQty(n)} ${u}`).join(" · ") || "—";
  };
  const valueTotal = (list: Row[]) => round2(list.reduce((s, r) => s + valueOf(r), 0));

  const filters = { q, brand: p.brand, group, status: p.status, view: grouped ? "grouped" : undefined };
  const groupName = group === NO_GROUP ? t("গ্রুপ ছাড়া") : groups.find((g) => g.id === group)?.name;
  const filterText = [
    `${t("তারিখ:")} ${formatDate(new Date())}`,
    groupName ? `${t("গ্রুপ")}: ${groupName}` : "",
    p.brand ? `${t("কোম্পানি / ব্র্যান্ড")}: ${brands.find((b) => b.id === p.brand)?.name ?? ""}` : "",
    q ? `${t("খোঁজ:")} ${q}` : "",
    `${t("মোট")} ${toBnDigits(total)} ${t("টি পণ্য")}`,
  ].filter(Boolean).join(" · ");
  // the print button prints this page when every row is on it; otherwise it opens the full list (?print=1)
  const printHref = everything || total <= rows.length ? null : `/depot/products${buildQuery(filters, { print: "1" })}`;
  const viewHref = (v?: string) => `/depot/products${buildQuery({ ...filters, view: v })}`;
  const cols = grouped ? 9 : 10;
  // a total row: the label spans the columns before the stock — brand and commission are not printed, hence two cells
  const before = grouped ? 7 : 8;

  const productRow = (r: Row, i: number) => {
    const stock = num(r.stock);
    return (
      <tr key={r.id}>
        <td className="text-sm tabular-nums">{toBnDigits(i + 1)}</td>
        <td className="text-sm">{r.code ?? "—"}{r.barcode ? <span className="block text-xs text-slate-400 print:hidden">{r.barcode}</span> : null}</td>
        <td>
          {printing ? <span className="font-semibold">{r.name}</span> : <Link prefetch={false} href={`/depot/products/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.name}</Link>}
          {!r.isActive && <Badge tone="slate">{t("নিষ্ক্রিয়")}</Badge>}
        </td>
        {!grouped && <td className="text-sm">{r.category?.name ?? "—"}</td>}
        <td className="text-sm print:hidden">{r.brand?.name ?? "—"}</td>
        <td className="num">{money(num(r.purchasePrice))}</td>
        <td className="num">{money(num(r.salePrice))}</td>
        <td className="num text-sm print:hidden">{commissionText({ depotCommissionType: r.depotCommissionType, depotCommissionRate: num(r.depotCommissionRate), purchasePrice: num(r.purchasePrice) }, money)}</td>
        <td className="num">
          {printing ? `${formatQty(stock)} ${r.unit.name}` : <Badge tone={stock <= 0 ? "red" : stock <= num(r.minStock) ? "amber" : "green"}>{formatQty(stock)} {r.unit.name}</Badge>}
        </td>
        <td className="num">{money(valueOf(r))}</td>
      </tr>
    );
  };

  return (
    <>
      {printing && <AutoPrint />}
      <div className="no-print">
        <PageHeader
          title="ডিপো পণ্য তালিকা"
          description="ডিলারি (ডিপো) পণ্য — শুধু ডিপোর স্টক ইন, ডেলিভারি চালান ও ডিপো স্টক সমন্বয়ে আসে; সাধারণ বিক্রয়, পস ও স্টকের সাথে মেশে না"
          crumbs={[{ label: "ডিপো ব্যবস্থাপনা" }, { label: "ডিপো পণ্য তালিকা" }]}
          actions={
            printing ? (
              <>
                <Link prefetch={false} href={`/depot/products${buildQuery(filters)}`} className="btn-secondary">{t("← তালিকায় ফিরুন")}</Link>
                <DepotProductsPrintButton allHref={null} />
              </>
            ) : (
              <>
                <DepotProductsPrintButton allHref={printHref} />
                {canManage && <Link prefetch={false} href="/depot/products/new" className="btn-primary">+ {t("নতুন ডিপো পণ্য")}</Link>}
              </>
            )
          }
        />
        {!printing && (
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="সক্রিয় ডিপো পণ্য" value={toBnDigits(all.length)} />
            <StatCard label="ডিপো স্টক মূল্য (গড় দরে)" value={money(stockValue)} tone="blue" />
            <StatCard label="এই তালিকায়" value={toBnDigits(total)} />
          </div>
        )}
      </div>
      <section className="panel print-area">
        {!printing && (
          <>
            <FilterBar action="/depot/products">
              {grouped && <input type="hidden" name="view" value="grouped" />}
              <FilterField label="খুঁজুন"><input name="q" defaultValue={q} placeholder={t("নাম, কোড, বারকোড…")} className="input w-56" /></FilterField>
              <FilterField label="পণ্য গ্রুপ / ক্যাটাগরি">
                <select name="group" id="depot-group" defaultValue={group ?? ""} className="input w-44">
                  <option value="">{t("সব গ্রুপ")}</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  <option value={NO_GROUP}>{t("গ্রুপ ছাড়া")}</option>
                </select>
              </FilterField>
              <FilterField label="কোম্পানি / ব্র্যান্ড">
                <select name="brand" defaultValue={p.brand ?? ""} className="input w-44"><option value="">{t("সব")}</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              </FilterField>
              <FilterField label="অবস্থা">
                <select name="status" defaultValue={p.status ?? "active"} className="input w-28"><option value="active">{t("সক্রিয়")}</option><option value="inactive">{t("নিষ্ক্রিয়")}</option><option value="all">{t("সব")}</option></select>
              </FilterField>
            </FilterBar>
            <div className="no-print flex items-center gap-2 border-b border-rule px-3 py-2 text-sm" role="group" aria-label={t("দেখার ধরন")} id="depot-view">
              <span className="text-slate-500">{t("দেখার ধরন")}:</span>
              <Link prefetch={false} href={viewHref(undefined)} aria-pressed={!grouped} className={`rounded px-2 py-1 ${grouped ? "text-ink-700 hover:bg-ink-50" : "bg-brand-600 text-white"}`}>☰ {t("তালিকা")}</Link>
              <Link prefetch={false} href={viewHref("grouped")} aria-pressed={grouped} className={`rounded px-2 py-1 ${grouped ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-50"}`} id="depot-view-grouped">▤ {t("গ্রুপ অনুযায়ী")}</Link>
            </div>
          </>
        )}
        <div className={printing ? "p-4 print:p-0" : undefined}>
          <PrintHeader business={ctx.business} title={t("ডিপো পণ্য তালিকা")} subtitle={filterText} />
          {printing && <p className="no-print mb-3 text-sm text-slate-600">{filterText}</p>}
          {rows.length === 0 ? <EmptyState message={q || p.brand || group ? "কোনো ডিপো পণ্য পাওয়া যায়নি" : "এখনও কোনো ডিপো পণ্য নেই — “+ নতুন ডিপো পণ্য” দিয়ে যোগ করুন"} /> : (
            <TableWrap>
              <table className="table print-grid print:text-[10px]" id="depot-products">
                <thead>
                  <tr>
                    <th>{t("ক্রমিক")}</th>
                    <th>{t("পণ্য কোড")}</th>
                    <th>{t("পণ্যের নাম")}</th>
                    {!grouped && <th>{t("গ্রুপ")}</th>}
                    <th className="print:hidden">{t("কোম্পানি / ব্র্যান্ড")}</th>
                    <th className="num">{t("ডিপি (ক্রয়)")}</th>
                    <th className="num">{t("ডিলার রেট")}</th>
                    <th className="num print:hidden">{t("কমিশন")}</th>
                    <th className="num">{t("বর্তমান ডিপো স্টক")}</th>
                    <th className="num">{t("স্টক মূল্য")}</th>
                  </tr>
                </thead>
                {grouped ? (
                  sections.map((s) => (
                    <tbody key={s.key} className="depot-group" data-group={s.name}>
                      <tr className="bg-ink-50 print:break-after-avoid">
                        <th colSpan={cols} className="text-left text-sm font-bold text-ink-900">{s.name} <span className="font-normal text-slate-500">({toBnDigits(s.rows.length)} {t("টি পণ্য")})</span></th>
                      </tr>
                      {s.rows.map((r, i) => productRow(r, i))}
                      <tr className="font-semibold depot-subtotal">
                        <td colSpan={before} className="print:hidden">{t("উপমোট — {0}", { 0: s.name })}</td>
                        <td colSpan={before - 2} className="hidden print:table-cell">{t("উপমোট — {0}", { 0: s.name })}</td>
                        <td className="num">{stockText(s.rows)}</td>
                        <td className="num">{money(valueTotal(s.rows))}</td>
                      </tr>
                    </tbody>
                  ))
                ) : (
                  <tbody>{rows.map((r, i) => productRow(r, skip + i))}</tbody>
                )}
                {(grouped || printing) && (
                  <tfoot>
                    <tr className="font-bold">
                      <td colSpan={before} className="print:hidden">{t("সর্বমোট ({0} টি পণ্য)", { 0: toBnDigits(rows.length) })}</td>
                      <td colSpan={before - 2} className="hidden print:table-cell">{t("সর্বমোট ({0} টি পণ্য)", { 0: toBnDigits(rows.length) })}</td>
                      <td className="num">{stockText(rows)}</td>
                      <td className="num">{money(valueTotal(rows))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </TableWrap>
          )}
        </div>
        {!everything && <Pagination basePath="/depot/products" params={p} page={page} totalPages={totalPages(total)} total={total} />}
      </section>
    </>
  );
}

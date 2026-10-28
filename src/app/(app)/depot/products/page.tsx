import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { ci } from "@/lib/dialect";
import { commissionText, DEPOT_ACCESS, isDepot } from "@/lib/depot";
import { formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, StatCard, TableWrap } from "@/components/ui";
import { getT } from "@/server/i18n";
import { can, requirePermission } from "@/server/auth";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { DepotOnlyNotice } from "../depot-ui";
import { digitVariants, toAsciiDigits } from "@/lib/digits";

export const metadata: Metadata = { title: "ডিপো পণ্য তালিকা" };

/** Depot (dealership) products only — the general products are on /products. */
export default async function DepotProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(DEPOT_ACCESS.productsView);
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  const p = await readParams(searchParams);
  const { page, skip, take } = pageOf(p);
  const cur = ctx.business.currencySymbol;
  const businessId = ctx.business.id;
  const q = p.q?.trim();
  const where: Prisma.ProductWhereInput = {
    businessId,
    isDepotProduct: true,
    ...(q ? { OR: [...digitVariants(q).map((v) => ({ name: ci(v) })), { code: ci(toAsciiDigits(q)) }, { barcode: { contains: toAsciiDigits(q) } }] } : {}),
    ...(p.brand ? { brandId: p.brand } : {}),
    ...(p.status === "inactive" ? { isActive: false } : p.status === "all" ? {} : { isActive: true }),
  };
  const [rows, total, brands, all] = await Promise.all([
    prisma.product.findMany({ where, orderBy: [{ brand: { name: "asc" } }, { name: "asc" }], skip, take, include: { unit: { select: { name: true } }, brand: { select: { name: true } } } }),
    prisma.product.count({ where }),
    prisma.brand.findMany({ where: { businessId, products: { some: { isDepotProduct: true } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.product.findMany({ where: { businessId, isDepotProduct: true, isActive: true }, select: { stock: true, avgCost: true } }),
  ]);
  const stockValue = round2(all.reduce((s, r) => s + num(r.stock) * num(r.avgCost), 0));
  const canManage = can(ctx, DEPOT_ACCESS.products);
  const t = await getT();
  return (
    <>
      <PageHeader
        title="ডিপো পণ্য তালিকা"
        description="ডিলারি (ডিপো) পণ্য — শুধু ডিপোর স্টক ইন, ডেলিভারি চালান ও ডিপো স্টক সমন্বয়ে আসে; সাধারণ বিক্রয়, পস ও স্টকের সাথে মেশে না"
        crumbs={[{ label: "ডিপো ব্যবস্থাপনা" }, { label: "ডিপো পণ্য তালিকা" }]}
        actions={canManage ? <Link prefetch={false} href="/depot/products/new" className="btn-primary">+ {t("নতুন ডিপো পণ্য")}</Link> : undefined}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="সক্রিয় ডিপো পণ্য" value={toBnDigits(all.length)} />
        <StatCard label="ডিপো স্টক মূল্য (গড় দরে)" value={formatMoney(stockValue, cur)} tone="blue" />
        <StatCard label="এই তালিকায়" value={toBnDigits(total)} />
      </div>
      <section className="panel">
        <FilterBar action="/depot/products">
          <FilterField label="খুঁজুন"><input name="q" defaultValue={q} placeholder={t("নাম, কোড, বারকোড…")} className="input w-56" /></FilterField>
          <FilterField label="কোম্পানি / ব্র্যান্ড">
            <select name="brand" defaultValue={p.brand ?? ""} className="input w-44"><option value="">{t("সব")}</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </FilterField>
          <FilterField label="অবস্থা">
            <select name="status" defaultValue={p.status ?? "active"} className="input w-28"><option value="active">{t("সক্রিয়")}</option><option value="inactive">{t("নিষ্ক্রিয়")}</option><option value="all">{t("সব")}</option></select>
          </FilterField>
        </FilterBar>
        {rows.length === 0 ? <EmptyState message={q || p.brand ? "কোনো ডিপো পণ্য পাওয়া যায়নি" : "এখনও কোনো ডিপো পণ্য নেই — “+ নতুন ডিপো পণ্য” দিয়ে যোগ করুন"} /> : (
          <TableWrap>
            <table className="table" id="depot-products">
              <thead>
                <tr><th>{t("পণ্য কোড")}</th><th>{t("পণ্যের নাম")}</th><th>{t("কোম্পানি / ব্র্যান্ড")}</th><th className="num">{t("ডিপি (ক্রয়)")}</th><th className="num">{t("ডিলার রেট")}</th><th className="num">{t("কমিশন")}</th><th className="num">{t("বর্তমান ডিপো স্টক")}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const stock = num(r.stock);
                  return (
                    <tr key={r.id}>
                      <td className="text-sm">{r.code ?? "—"}{r.barcode ? <span className="block text-xs text-slate-400">{r.barcode}</span> : null}</td>
                      <td>
                        <Link prefetch={false} href={`/depot/products/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.name}</Link>
                        {!r.isActive && <Badge tone="slate">{t("নিষ্ক্রিয়")}</Badge>}
                      </td>
                      <td className="text-sm">{r.brand?.name ?? "—"}</td>
                      <td className="num">{formatMoney(num(r.purchasePrice), cur)}</td>
                      <td className="num">{formatMoney(num(r.salePrice), cur)}</td>
                      <td className="num text-sm">{commissionText({ depotCommissionType: r.depotCommissionType, depotCommissionRate: num(r.depotCommissionRate), purchasePrice: num(r.purchasePrice) }, (n) => formatMoney(n, cur))}</td>
                      <td className="num"><Badge tone={stock <= 0 ? "red" : stock <= num(r.minStock) ? "amber" : "green"}>{formatQty(stock)} {r.unit.name}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/depot/products" params={p} page={page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}

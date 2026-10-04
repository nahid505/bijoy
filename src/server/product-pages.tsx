import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { VOUCHER_TYPES } from "@/lib/accounting";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { ActionButton } from "@/components/forms";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, SortHeader, TableWrap } from "@/components/ui";
import { can, requirePermission } from "./auth";
import { pageOf, readParams, totalPages, type SearchParams } from "./params";
import { deleteProductAction, saveProductAction, toggleProductAction } from "./actions/masters";
import { ProductForm } from "@/app/(app)/products/product-form";
import { availableBatches } from "./services/inventory";
import { businessToday } from "./services/notifications";
import { expiryStatus } from "@/lib/expiry";
import { ExpiryBadge } from "@/components/expiry-badge";

const MOVE_LABELS: Record<string, string> = {
  OPENING: "প্রারম্ভিক", PURCHASE: "ক্রয়", SALE: "বিক্রয়", SALES_RETURN: "বিক্রয় ফেরত", PURCHASE_RETURN: "ক্রয় ফেরত", ADJUSTMENT_IN: "সমন্বয় (আগমন)", ADJUSTMENT_OUT: "সমন্বয় (বাহির)",
};

export async function ProductListPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("inventory:view");
  const p = await readParams(searchParams);
  const { page, skip, take } = pageOf(p);
  const cur = ctx.business.currencySymbol;
  const q = p.q?.trim();
  const businessId = ctx.business.id;
  const lowIds = p.low
    ? (await prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Product" WHERE "businessId" = ${businessId} AND ("stock" <= "minStock" OR "stock" <= 0)`).map((r) => r.id)
    : null;
  const where: Prisma.ProductWhereInput = {
    businessId,
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { barcode: { contains: q } }] } : {}),
    ...(p.category ? { categoryId: p.category } : {}),
    ...(p.brand ? { brandId: p.brand } : {}),
    ...(p.status === "inactive" ? { isActive: false } : p.status === "all" ? {} : { isActive: true }),
    ...(lowIds ? { id: { in: lowIds } } : {}),
  };
  const [rows, total, categories, brands, value] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: p.sort === "stock" ? { stock: p.dir === "desc" ? "desc" : "asc" } : p.sort === "price" ? { salePrice: p.dir === "desc" ? "desc" : "asc" } : p.sort === "code" ? { code: p.dir === "desc" ? "desc" : "asc" } : { name: p.dir === "desc" ? "desc" : "asc" },
      skip,
      take,
      include: { unit: true, category: true, brand: true },
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
    prisma.brand.findMany({ where: { businessId }, orderBy: { name: "asc" } }),
    prisma.$queryRaw<{ v: string | null; n: bigint }[]>`SELECT SUM("stock" * "avgCost")::text AS v, COUNT(*) AS n FROM "Product" WHERE "businessId" = ${businessId} AND "isActive" = true`,
  ]);

  // nearest expiry among in-stock batches of the products on this page
  const today = businessToday();
  const nearestRows = await prisma.productBatch.groupBy({
    by: ["productId"],
    where: { productId: { in: rows.filter((r) => r.trackBatch).map((r) => r.id) }, quantity: { gt: 0 }, expiryDate: { not: null } },
    _min: { expiryDate: true },
    _count: true,
  });
  const nearest = new Map(nearestRows.map((n) => [n.productId, { expiry: n._min.expiryDate!, batches: n._count }]));

  return (
    <>
      <PageHeader
        title="সকল পণ্য"
        description={`সক্রিয় পণ্য ${formatQty(Number(value[0]?.n ?? 0))} টি · মজুদ মূল্য ${formatMoney(num(value[0]?.v), cur)}`}
        crumbs={[{ label: "পণ্য" }, { label: "সকল পণ্য" }]}
        actions={can(ctx, "inventory:manage") && <Link prefetch={false} href="/products/new" className="btn-primary">+ নতুন পণ্য</Link>}
      />
      <section className="panel">
        <FilterBar action="/products">
          <FilterField label="খুঁজুন"><input name="q" defaultValue={q} placeholder="নাম, কোড, বারকোড…" className="input w-56" /></FilterField>
          <FilterField label="ক্যাটাগরি">
            <select name="category" defaultValue={p.category ?? ""} className="input w-40"><option value="">সব</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </FilterField>
          <FilterField label="ব্র্যান্ড">
            <select name="brand" defaultValue={p.brand ?? ""} className="input w-36"><option value="">সব</option>{brands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </FilterField>
          <FilterField label="অবস্থা">
            <select name="status" defaultValue={p.status ?? "active"} className="input w-28"><option value="active">সক্রিয়</option><option value="inactive">নিষ্ক্রিয়</option><option value="all">সব</option></select>
          </FilterField>
          <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={!!p.low} /> কম মজুদ</label>
        </FilterBar>
        {rows.length === 0 ? <EmptyState /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><SortHeader basePath="/products" params={p} field="name" label="পণ্য" /><th>ক্যাটাগরি / ব্র্যান্ড</th><th className="num">ক্রয়মূল্য (গড়)</th><SortHeader basePath="/products" params={p} field="price" label="বিক্রয়মূল্য" className="num" /><th className="num">পাইকারি</th><SortHeader basePath="/products" params={p} field="stock" label="মজুদ" className="num" /><th className="num">মজুদ মূল্য</th><th>মেয়াদ (নিকটতম ব্যাচ)</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const stock = num(r.stock);
                  const low = stock <= num(r.minStock);
                  return (
                    <tr key={r.id}>
                      <td>
                        <Link prefetch={false} href={`/products/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.name}</Link>
                        <span className="block text-xs text-slate-400">{[r.code, r.barcode].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className="text-xs">{r.category?.name ?? "—"}{r.brand ? ` / ${r.brand.name}` : ""}</td>
                      <td className="num">{formatMoney(num(r.avgCost) || num(r.purchasePrice), cur)}</td>
                      <td className="num">{formatMoney(num(r.salePrice), cur)}</td>
                      <td className="num">{num(r.wholesalePrice) ? formatMoney(num(r.wholesalePrice), cur) : "—"}</td>
                      <td className="num"><Badge tone={stock <= 0 ? "red" : low ? "amber" : "green"}>{formatQty(stock)} {r.unit.name}</Badge></td>
                      <td className="num">{formatMoney(round2(stock * num(r.avgCost)), cur)}</td>
                      <td>
                        {!r.trackBatch ? <span className="text-xs text-slate-300">—</span> : nearest.get(r.id) ? (
                          <Link prefetch={false} href={`/products/batches?product=${r.id}`} className="inline-flex flex-col gap-0.5">
                            <ExpiryBadge status={expiryStatus(nearest.get(r.id)!.expiry, today, ctx.business.expiryWarningDays)} />
                            <span className="text-[11px] text-slate-500">{formatDate(nearest.get(r.id)!.expiry)} · {toBnDigits(nearest.get(r.id)!.batches)} ব্যাচ</span>
                          </Link>
                        ) : <span className="text-xs text-slate-400">মজুদে ব্যাচ নেই</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/products" params={p} page={page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}

export async function ProductDetailPage({ id }: { id: string }) {
  const ctx = await requirePermission("inventory:view");
  const cur = ctx.business.currencySymbol;
  const pr = await prisma.product.findFirst({ where: { id, businessId: ctx.business.id }, include: { unit: true, category: true, brand: true } });
  if (!pr) notFound();
  const [moves, perWarehouse] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { productId: pr.id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      include: { voucher: { select: { id: true, voucherNo: true, type: true } }, warehouse: { select: { name: true } } },
      take: 2000,
    }),
    prisma.stockMovement.groupBy({ by: ["warehouseId"], where: { productId: pr.id }, _sum: { quantityIn: true, quantityOut: true } }),
  ]);
  const batches = pr.trackBatch ? await availableBatches(prisma, ctx.business.id, [pr.id]) : [];
  const warehouses = await prisma.warehouse.findMany({ where: { businessId: ctx.business.id } });
  let running = 0;
  const card = moves.map((m) => {
    running = round3(running + num(m.quantityIn) - num(m.quantityOut));
    return { ...m, running };
  });
  const manage = can(ctx, "inventory:manage");

  return (
    <>
      <PageHeader
        title={pr.name}
        description={[pr.code && `কোড ${pr.code}`, pr.barcode && `বারকোড ${pr.barcode}`, pr.category?.name, pr.brand?.name].filter(Boolean).join(" · ") || "পণ্যের বিবরণ ও স্টক কার্ড"}
        crumbs={[{ label: "পণ্য", href: "/products" }, { label: pr.name }]}
        actions={
          manage && (
            <>
              <Link prefetch={false} href={`/products/${pr.id}/edit`} className="btn-secondary">সম্পাদনা</Link>
              <ActionButton action={toggleProductAction.bind(null, pr.id, !pr.isActive)} label={pr.isActive ? "নিষ্ক্রিয়" : "সক্রিয়"} className="btn-secondary" />
              <ActionButton action={deleteProductAction.bind(null, pr.id)} label="মুছুন" className="btn-danger" confirmText="পণ্যটি মুছে ফেলতে চান?" />
            </>
          )
        }
      />
      <section className="panel mb-4">
        <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-6 sm:divide-y-0">
          {[
            ["বর্তমান মজুদ", `${formatQty(num(pr.stock))} ${pr.unit.name}`],
            ["গড় ক্রয়মূল্য", formatMoney(num(pr.avgCost), cur)],
            ["মজুদ মূল্য", formatMoney(round2(num(pr.stock) * num(pr.avgCost)), cur)],
            ["সর্বশেষ ক্রয়মূল্য", formatMoney(num(pr.purchasePrice), cur)],
            ["বিক্রয় / পাইকারি", `${formatMoney(num(pr.salePrice), cur)} / ${formatMoney(num(pr.wholesalePrice), cur)}`],
            ["ন্যূনতম মজুদ", `${formatQty(num(pr.minStock))} ${pr.unit.name}`],
          ].map(([l, v]) => (
            <div key={l} className="px-4 py-3"><p className="text-[11px] text-slate-500">{l}</p><p className="text-sm font-bold tabular-nums text-ink-900">{v}</p></div>
          ))}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-4">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">গুদামভিত্তিক মজুদ</h2></div>
          <table className="table"><tbody>
            {warehouses.map((w) => {
              const s = perWarehouse.find((x) => x.warehouseId === w.id);
              return <tr key={w.id}><td>{w.name}</td><td className="num">{formatQty(num(s?._sum.quantityIn) - num(s?._sum.quantityOut))} {pr.unit.name}</td></tr>;
            })}
          </tbody></table>
          {pr.trackBatch && (
            <>
              <div className="panel-head border-t border-rule"><h2 className="panel-title">ব্যাচ ও মেয়াদ</h2></div>
              {batches.length === 0 ? <EmptyState message="কোনো ব্যাচ নেই" /> : (
                <table className="table"><tbody>
                  {batches.map((b) => (
                    <tr key={`${b.warehouseId}-${b.batchNo}`}>
                      <td>{b.batchNo}<span className="block text-xs text-slate-500">{b.expiryDate ? `মেয়াদ ${formatDate(b.expiryDate)}` : "মেয়াদ নেই"}</span><ExpiryBadge status={expiryStatus(b.expiryDate, businessToday(), ctx.business.expiryWarningDays)} /></td>
                      <td className="num">{formatQty(b.quantity)} {pr.unit.name}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </>
          )}
        </section>
        <section className="panel lg:col-span-3">
          <div className="panel-head"><h2 className="panel-title">স্টক কার্ড (মজুদ খতিয়ান)</h2></div>
          {card.length === 0 ? <EmptyState message="কোনো স্টক লেনদেন নেই" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>তারিখ</th><th>ভাউচার</th><th>ধরন</th><th>গুদাম / ব্যাচ</th><th className="num">আগমন</th><th className="num">নির্গমন</th><th className="num">দর</th><th className="num">ব্যালেন্স</th></tr></thead>
                <tbody>
                  {card.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap">{formatDate(m.date)}</td>
                      <td>{m.voucher ? <Link prefetch={false} href={`/vouchers/v/${m.voucher.id}`} className="text-brand-700 hover:underline">{m.voucher.voucherNo}</Link> : "—"}</td>
                      <td>{m.voucher ? VOUCHER_TYPES[m.voucher.type].label : MOVE_LABELS[m.type]}</td>
                      <td className="text-xs">{m.warehouse.name}{m.batchNo ? ` · ${m.batchNo}` : ""}</td>
                      <td className="num text-brand-700">{num(m.quantityIn) ? formatQty(num(m.quantityIn)) : ""}</td>
                      <td className="num text-credit">{num(m.quantityOut) ? formatQty(num(m.quantityOut)) : ""}</td>
                      <td className="num">{formatMoney(num(m.unitCost), cur)}</td>
                      <td className="num font-semibold">{formatQty(m.running)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </section>
      </div>
    </>
  );
}

export async function ProductEditPage({ id }: { id: string | null }) {
  const ctx = await requirePermission("inventory:manage");
  const businessId = ctx.business.id;
  const [pr, categories, brands, units] = await Promise.all([
    id ? prisma.product.findFirst({ where: { id, businessId } }) : null,
    prisma.category.findMany({ where: { businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.brand.findMany({ where: { businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.unit.findMany({ where: { businessId, baseUnitId: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  if (id && !pr) notFound();
  const hasTransactions = pr ? (await prisma.voucherItem.count({ where: { productId: pr.id } })) > 0 : false;
  return (
    <>
      <PageHeader title={pr ? `সম্পাদনা: ${pr.name}` : "নতুন পণ্য"} crumbs={[{ label: "পণ্য", href: "/products" }, { label: pr?.name ?? "নতুন" }]} />
      <section className="panel max-w-4xl p-5">
        <ProductForm
          action={saveProductAction.bind(null, id)}
          categories={categories}
          brands={brands}
          units={units}
          hasTransactions={hasTransactions}
          cancelHref={pr ? `/products/${pr.id}` : "/products"}
          defaults={
            pr
              ? {
                  name: pr.name, code: pr.code, barcode: pr.barcode, categoryId: pr.categoryId, brandId: pr.brandId, unitId: pr.unitId,
                  purchasePrice: num(pr.purchasePrice), salePrice: num(pr.salePrice), wholesalePrice: num(pr.wholesalePrice),
                  minStock: num(pr.minStock), openingStock: num(pr.openingStock), openingRate: num(pr.openingRate), trackBatch: pr.trackBatch,
                }
              : {}
          }
        />
      </section>
    </>
  );
}

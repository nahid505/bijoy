import "server-only";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatQty, toBnDigits } from "@/lib/format";
import { CatalogForm } from "@/components/catalog-form";
import { ActionButton } from "@/components/forms";
import { Badge, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { can, requirePermission } from "./auth";
import { deleteCatalogAction, saveCatalogAction } from "./actions/masters";

type Kind = "category" | "brand" | "unit";

const CFG = {
  category: { title: "ক্যাটাগরি", path: "/products/categories" },
  brand: { title: "ব্র্যান্ড", path: "/products/brands" },
  unit: { title: "ইউনিট", path: "/products/units" },
} as const;

export async function CatalogPage({ kind, editId }: { kind: Kind; editId?: string }) {
  const ctx = await requirePermission("inventory:view");
  const businessId = ctx.business.id;
  const cfg = CFG[kind];
  const manage = can(ctx, "inventory:manage");

  const rows =
    kind === "unit"
      ? (await prisma.unit.findMany({ where: { businessId }, orderBy: [{ baseUnitId: "asc" }, { name: "asc" }], include: { baseUnit: true, _count: { select: { products: true } } } })).map((u) => ({
          id: u.id, name: u.name, baseUnitId: u.baseUnitId, factor: num(u.factor), extra: u.baseUnit ? `১ ${u.name} = ${formatQty(num(u.factor))} ${u.baseUnit.name}` : "মূল ইউনিট", count: u._count.products,
        }))
      : kind === "category"
        ? (await prisma.category.findMany({ where: { businessId }, orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } })).map((c) => ({ id: c.id, name: c.name, baseUnitId: null, factor: 1, extra: "", count: c._count.products }))
        : (await prisma.brand.findMany({ where: { businessId }, orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } })).map((c) => ({ id: c.id, name: c.name, baseUnitId: null, factor: 1, extra: "", count: c._count.products }));
  const editing = editId ? rows.find((r) => r.id === editId) : undefined;
  const baseUnits = kind === "unit" ? rows.filter((r) => !r.baseUnitId && r.id !== editId).map((r) => ({ id: r.id, name: r.name })) : [];

  return (
    <>
      <PageHeader
        title={cfg.title}
        description={kind === "unit" ? "মূল ইউনিট ও বিকল্প ইউনিট (যেমন ১ বস্তা = ৫০ কেজি) — বিকল্প ইউনিটে কেনাবেচা করলে স্টক মূল ইউনিটে রূপান্তরিত হয়" : undefined}
        crumbs={[{ label: "পণ্য", href: "/products" }, { label: cfg.title }]}
      />
      {manage && (
        <section className="panel mb-4 p-4">
          <CatalogForm
            key={editId ?? "new"}
            kind={kind}
            action={saveCatalogAction.bind(null, kind, editing?.id ?? null)}
            returnTo={cfg.path}
            editing={!!editing}
            defaults={editing ? { name: editing.name, baseUnitId: editing.baseUnitId, factor: editing.factor } : undefined}
            baseUnits={baseUnits}
          />
        </section>
      )}
      <section className="panel">
        {rows.length === 0 ? <EmptyState /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>নাম</th>{kind === "unit" && <th>রূপান্তর</th>}<th className="num">পণ্য</th>{manage && <th />}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.name}</td>
                    {kind === "unit" && <td>{r.baseUnitId ? r.extra : <Badge tone="blue">{r.extra}</Badge>}</td>}
                    <td className="num">{toBnDigits(r.count)}</td>
                    {manage && (
                      <td className="text-right">
                        <div className="flex justify-end gap-2">
                          <Link prefetch={false} href={`${cfg.path}?edit=${r.id}`} className="btn-secondary btn-sm">সম্পাদনা</Link>
                          <ActionButton action={deleteCatalogAction.bind(null, kind, r.id)} label="মুছুন" confirmText="মুছে ফেলতে চান?" />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </>
  );
}

export async function WarehousePanel({ editId }: { editId?: string }) {
  const ctx = await requirePermission("inventory:view");
  const manage = can(ctx, "inventory:manage");
  const list = await prisma.warehouse.findMany({ where: { businessId: ctx.business.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  const editing = list.find((w) => w.id === editId);
  return (
    <section className="panel mb-4">
      <div className="panel-head"><h2 className="panel-title">গুদাম</h2></div>
      {manage && (
        <div className="border-b border-rule p-3">
          <CatalogForm key={editId ?? "new"} kind="warehouse" action={saveCatalogAction.bind(null, "warehouse", editing?.id ?? null)} returnTo="/products/stock" editing={!!editing} defaults={editing ? { name: editing.name, address: editing.address } : undefined} />
        </div>
      )}
      <table className="table">
        <tbody>
          {list.map((w) => (
            <tr key={w.id}>
              <td className="font-medium">{w.name} {w.isDefault && <Badge tone="green">প্রধান</Badge>}</td>
              <td className="text-xs text-slate-500">{w.address}</td>
              {manage && (
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <Link prefetch={false} href={`/products/stock?edit=${w.id}`} className="btn-secondary btn-sm">সম্পাদনা</Link>
                    {!w.isDefault && <ActionButton action={deleteCatalogAction.bind(null, "warehouse", w.id)} label="মুছুন" confirmText="গুদাম মুছে ফেলতে চান?" />}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

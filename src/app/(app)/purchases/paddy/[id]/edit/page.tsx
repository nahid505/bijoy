import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { savePaddyPurchaseAction } from "@/server/actions/paddy";
import { loadPaddyPurchase } from "@/server/services/paddy";
import { PaddyPurchaseForm } from "../../paddy-form";

export const metadata: Metadata = { title: "ধান ক্রয় সম্পাদনা" };

export default async function EditPaddyPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("purchases:edit");
  const [pp, warehouses] = await Promise.all([
    loadPaddyPurchase(ctx.business.id, id),
    prisma.warehouse.findMany({ where: { businessId: ctx.business.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  if (!pp) notFound();
  const v = pp.voucher;
  const item = v.items[0];
  const pay = v.payments[0];
  const product = item?.product;
  return (
    <>
      <PageHeader title={`সম্পাদনা: ধান ক্রয় ${v.voucherNo}`} description="সংরক্ষণ করলে আগের স্টক ও হিসাব বাতিল হয়ে নতুনভাবে পোস্ট হবে (একই নম্বর থাকবে)" crumbs={[{ label: "ধান ক্রয়", href: "/purchases/paddy" }, { label: v.voucherNo, href: `/vouchers/v/${v.id}` }, { label: "সম্পাদনা" }]} />
      <section className="panel p-5">
        <PaddyPurchaseForm
          action={savePaddyPurchaseAction.bind(null, v.id)}
          warehouses={warehouses}
          cashAccounts={pay ? [{ id: pay.account.id, name: pay.account.name, group: "" }] : []}
          multiWarehouse={ctx.features.includes("MULTI_WAREHOUSE")}
          currency={ctx.business.currencySymbol}
          dateLocked={!canChangeEntryDate(ctx)}
          defaults={{
            date: toDateInput(v.date), warehouseId: v.warehouseId, batchNo: item?.batchNo ?? "",
            supplier: v.partyAccount ? { id: v.partyAccount.id, name: v.partyAccount.name, group: "" } : null,
            product: product ? { ...product, salePrice: num(product.salePrice), wholesalePrice: num(product.wholesalePrice), purchasePrice: num(product.purchasePrice), avgCost: num(product.avgCost), stock: num(product.stock) } : null,
            bagCount: String(pp.bagCount), grossKg: String(num(pp.grossKg)), dhaltaKg: String(num(pp.dhaltaKg)), ratePerMon: String(num(pp.ratePerMon)),
            paidAmount: String(num(v.paidAmount)), cashAccountId: pay?.account.id ?? "", reference: v.reference ?? "", notes: pp.notes ?? "",
          }}
        />
      </section>
    </>
  );
}

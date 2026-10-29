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
import { canSeeVoucher } from "@/server/party-scope";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";

export const metadata: Metadata = { title: "ধান ক্রয় সম্পাদনা" };

export default async function EditPaddyPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(RICE_MILL_ACCESS.paddyEdit);
  const [pp, warehouses] = await Promise.all([
    loadPaddyPurchase(ctx.business.id, id),
    prisma.warehouse.findMany({ where: { businessId: ctx.business.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  if (!pp || !(await canSeeVoucher(ctx, id))) notFound(); // assigned-only roles: their suppliers only
  const v = pp.voucher;
  const item = v.items[0];
  const pay = v.payments[0];
  const product = item?.product;
  // the slip's labour payment (paid from the same cash / bank as the purchase)
  const labour = await prisma.voucher.findFirst({ where: { businessId: ctx.business.id, sourceKey: `paddy-labour:${v.id}` }, select: { cashAccount: { select: { id: true, name: true } } } });
  const cashAccount = pay?.account ?? labour?.cashAccount ?? null;
  const dec = (d: unknown) => (d === null || d === undefined ? "" : String(num(d as never)));
  return (
    <>
      <PageHeader title={`সম্পাদনা: ধান ক্রয় ${v.voucherNo}`} description="সংরক্ষণ করলে আগের স্টক ও হিসাব বাতিল হয়ে নতুনভাবে পোস্ট হবে (একই নম্বর থাকবে)" crumbs={[{ label: "ধান ক্রয়", href: "/purchases/paddy" }, { label: v.voucherNo, href: `/vouchers/v/${v.id}` }, { label: "সম্পাদনা" }]} />
      <section className="panel p-5">
        <PaddyPurchaseForm
          action={savePaddyPurchaseAction.bind(null, v.id)}
          warehouses={warehouses}
          cashAccounts={cashAccount ? [{ id: cashAccount.id, name: cashAccount.name, group: "" }] : []}
          multiWarehouse={ctx.features.includes("MULTI_WAREHOUSE")}
          currency={ctx.business.currencySymbol}
          dateLocked={!canChangeEntryDate(ctx)}
          defaults={{
            date: toDateInput(v.date), warehouseId: v.warehouseId, batchNo: item?.batchNo ?? "",
            supplier: v.partyAccount ? { id: v.partyAccount.id, name: v.partyAccount.name, group: "" } : null,
            product: product ? { ...product, salePrice: num(product.salePrice), wholesalePrice: num(product.wholesalePrice), purchasePrice: num(product.purchasePrice), avgCost: num(product.avgCost), stock: num(product.stock) } : null,
            bagCount: String(pp.bagCount), grossKg: String(num(pp.grossKg)), dhaltaKg: String(num(pp.dhaltaKg)), ratePerMon: String(num(pp.ratePerMon)),
            paidAmount: String(num(v.paidAmount)), cashAccountId: cashAccount?.id ?? "", reference: v.reference ?? "", notes: pp.notes ?? "",
            variety: pp.variety ?? "", moisturePct: dec(pp.moisturePct), vehicleGrossKg: dec(pp.vehicleGrossKg), vehicleTareKg: dec(pp.vehicleTareKg), labourCost: num(pp.labourCost) ? String(num(pp.labourCost)) : "",
          }}
        />
      </section>
    </>
  );
}

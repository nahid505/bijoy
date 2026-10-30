import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { DEPOT_ACCESS, isDepot } from "@/lib/depot";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { searchParties, toProductOption } from "@/server/lookup";
import { saveDepotDeliveryAction } from "@/server/actions/depot";
import { loadDepotDelivery } from "@/server/services/depot";
import { inventoryOptions } from "@/server/voucher-editor";
import { DepotDeliveryForm } from "../../../delivery-form";
import { DepotOnlyNotice } from "../../../depot-ui";
import { canSeeVoucher } from "@/server/party-scope";

export const metadata: Metadata = { title: "ডেলিভারি চালান সম্পাদনা" };

export default async function EditDepotDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(DEPOT_ACCESS.deliveryEdit);
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  const d = await loadDepotDelivery(ctx.business.id, id);
  if (!d || !(await canSeeVoucher(ctx, id))) notFound(); // assigned-only roles: their parties only
  const v = d.voucher;
  const [warehouses, dealers, companies, inv] = await Promise.all([
    prisma.warehouse.findMany({ where: { businessId: ctx.business.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    d.dealerAccountId ? searchParties(ctx.business.id, "CUSTOMER", "", { accountIds: [d.dealerAccountId], dealer: true }) : [],
    d.companyAccountId ? searchParties(ctx.business.id, "SUPPLIER", "", { accountIds: [d.companyAccountId], book: "DEPOT" }) : [],
    inventoryOptions(ctx.business.id, { book: "DEPOT", includeProductIds: v.items.map((i) => i.productId) }),
  ]);
  const pay = v.payments[0];
  return (
    <>
      <PageHeader title={`সম্পাদনা: ডেলিভারি চালান ${v.voucherNo}`} description="সংরক্ষণ করলে আগের স্টক ও হিসাব বাতিল হয়ে নতুনভাবে পোস্ট হবে (একই নম্বর থাকবে)" crumbs={[{ label: "ডেলিভারি চালান", href: "/depot/deliveries" }, { label: v.voucherNo, href: `/vouchers/v/${v.id}` }, { label: "সম্পাদনা" }]} />
      <section className="panel p-5">
        <DepotDeliveryForm
          action={saveDepotDeliveryAction.bind(null, v.id)}
          warehouses={warehouses}
          cashAccounts={pay ? [{ id: pay.account.id, name: pay.account.name, group: "" }] : []}
          products={inv.products}
          categories={inv.categories}
          multiWarehouse={ctx.features.includes("MULTI_WAREHOUSE")}
          currency={ctx.business.currencySymbol}
          dateLocked={!canChangeEntryDate(ctx)}
          lockMode
          cancelHref={`/vouchers/v/${v.id}`}
          defaults={{
            mode: d.mode, date: toDateInput(v.date), doNumber: d.doNumber ?? "", company: companies[0] ?? null, dealer: dealers[0] ?? null,
            warehouseId: v.warehouseId ?? v.items[0]?.warehouseId ?? null, vehicleNo: d.vehicleNo ?? "", driverName: d.driverName ?? "", notes: d.notes ?? "",
            lines: v.items.map((i, k) => ({ key: k + 1, product: toProductOption(i.product), quantity: String(num(i.quantity)), freeQuantity: num(i.freeQuantity) ? String(num(i.freeQuantity)) : "", rate: String(num(i.rate)), challanRate: String(i.challanRate === null ? num(i.product.purchasePrice) : num(i.challanRate)) })),
            paidAmount: String(num(v.paidAmount)), cashAccountId: pay?.account.id ?? "",
          }}
        />
      </section>
    </>
  );
}

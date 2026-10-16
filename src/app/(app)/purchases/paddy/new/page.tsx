import type { Metadata } from "next";
import { prisma, num } from "@/lib/db";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { savePaddyPurchaseAction } from "@/server/actions/paddy";
import { defaultPaddyProduct } from "@/server/services/paddy";
import { PaddyPurchaseForm } from "../paddy-form";

export const metadata: Metadata = { title: "নতুন ধান ক্রয়" };

export default async function NewPaddyPurchasePage() {
  const ctx = await requirePermission("purchases:create");
  const [paddy, warehouses, cash] = await Promise.all([
    defaultPaddyProduct(ctx.business.id),
    prisma.warehouse.findMany({ where: { businessId: ctx.business.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.account.findFirst({ where: { businessId: ctx.business.id, systemKey: "CASH" }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="নতুন ধান ক্রয়" description="ওজন স্লিপ অনুযায়ী লিখুন — নিট ওজন, মণ ও মোট দাম সাথে সাথে হিসাব হবে" crumbs={[{ label: "ধান ক্রয়", href: "/purchases/paddy" }, { label: "নতুন" }]} />
      <section className="panel p-5">
        <PaddyPurchaseForm
          action={savePaddyPurchaseAction.bind(null, null)}
          warehouses={warehouses}
          cashAccounts={cash ? [{ id: cash.id, name: cash.name, group: "" }] : []}
          multiWarehouse={ctx.features.includes("MULTI_WAREHOUSE")}
          currency={ctx.business.currencySymbol}
          dateLocked={!canChangeEntryDate(ctx)}
          defaults={{
            date: toDateInput(), supplier: null, warehouseId: warehouses[0]?.id ?? null, batchNo: "",
            product: paddy ? { ...paddy, salePrice: num(paddy.salePrice), wholesalePrice: num(paddy.wholesalePrice), purchasePrice: num(paddy.purchasePrice), avgCost: num(paddy.avgCost), stock: num(paddy.stock) } : null,
            bagCount: "", grossKg: "", dhaltaKg: "", ratePerMon: "", paidAmount: "", cashAccountId: cash?.id ?? "", reference: "", notes: "",
          }}
        />
      </section>
    </>
  );
}

import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { DEPOT_ACCESS, isDepot } from "@/lib/depot";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { readParams, type SearchParams } from "@/server/params";
import { saveDepotDeliveryAction } from "@/server/actions/depot";
import { DepotDeliveryForm } from "../../delivery-form";
import { DepotOnlyNotice } from "../../depot-ui";

export const metadata: Metadata = { title: "নতুন ডেলিভারি চালান" };

export default async function NewDepotDeliveryPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(DEPOT_ACCESS.deliveryCreate);
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  const p = await readParams(searchParams);
  const [warehouses, cash] = await Promise.all([
    prisma.warehouse.findMany({ where: { businessId: ctx.business.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.account.findFirst({ where: { businessId: ctx.business.id, systemKey: "CASH" }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="নতুন ডেলিভারি চালান" description="ডিও রিলিজ (কোম্পানি পেইড) অথবা মার্কেট সেলস (ডিপো কালেকশন)" crumbs={[{ label: "ডিপো ব্যবস্থাপনা" }, { label: "ডেলিভারি চালান", href: "/depot/deliveries" }, { label: "নতুন" }]} />
      <section className="panel p-5">
        <DepotDeliveryForm
          action={saveDepotDeliveryAction.bind(null, null)}
          warehouses={warehouses}
          cashAccounts={cash ? [{ id: cash.id, name: cash.name, group: "" }] : []}
          multiWarehouse={ctx.features.includes("MULTI_WAREHOUSE")}
          currency={ctx.business.currencySymbol}
          dateLocked={!canChangeEntryDate(ctx)}
          cancelHref="/depot/deliveries"
          defaults={{
            mode: p.mode === "DEPOT_COLLECTION" ? "DEPOT_COLLECTION" : "COMPANY_PAID",
            date: toDateInput(), doNumber: "", company: null, dealer: null, warehouseId: warehouses[0]?.id ?? null,
            vehicleNo: "", driverName: "", notes: "", lines: [{ key: 1, product: null, quantity: "", freeQuantity: "", rate: "", challanRate: "" }], paidAmount: "", cashAccountId: cash?.id ?? "",
          }}
        />
      </section>
    </>
  );
}

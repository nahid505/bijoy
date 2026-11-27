import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { num } from "@/lib/db";
import { toDateInput } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { saveProductionAction } from "@/server/actions/production";
import { loadProduction, productionFormData, toProductOption } from "@/server/services/production";
import { ProductionForm } from "../../production-forms";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";

export const metadata: Metadata = { title: "উৎপাদন সম্পাদনা" };

export default async function EditProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission(RICE_MILL_ACCESS.milling);
  const [v, data] = await Promise.all([loadProduction(ctx.business.id, id), productionFormData(ctx.business.id)]);
  if (!v) notFound();

  const bagProductIds = new Set(data.packagingBags.map((b) => b.productId));
  const usedBagItem = v.items.find((i) => i.direction === -1 && bagProductIds.has(i.productId));
  const matchedBag = usedBagItem ? data.packagingBags.find((b) => b.productId === usedBagItem.productId) : null;
  const rawInputs = v.items.filter((i) => i.direction === -1 && !bagProductIds.has(i.productId));

  return (
    <>
      <PageHeader
        title={`সম্পাদনা: উৎপাদন ${v.voucherNo}`}
        description="সংরক্ষণ করলে আগের স্টক ও হিসাব বাতিল হয়ে নতুনভাবে পোস্ট হবে (একই নম্বর থাকবে)"
        crumbs={[{ label: "উৎপাদন", href: "/production" }, { label: v.voucherNo, href: `/vouchers/v/${v.id}` }, { label: "সম্পাদনা" }]}
      />
      <section className="panel p-5">
        <ProductionForm
          action={saveProductionAction.bind(null, v.id)}
          units={data.units}
          recipes={data.recipes}
          warehouses={data.warehouses}
          packagingBags={data.packagingBags}
          accounts={v.adjustmentAccount ? [{ id: v.adjustmentAccount.id, name: v.adjustmentAccount.name, group: "" }] : []}
          currency={ctx.business.currencySymbol}
          dateLocked={!canChangeEntryDate(ctx)}
          multiWarehouse={ctx.features.includes("MULTI_WAREHOUSE")}
          defaults={{
            date: toDateInput(v.date),
            recipeId: v.productionRun?.recipeId ?? null,
            warehouseId: v.items[0]?.warehouseId ?? null,
            reference: v.reference ?? "",
            narration: v.narration ?? "",
            extraCost: num(v.productionRun?.extraCost ?? 0),
            costAccountId: v.adjustmentAccountId ?? "",
            bagProductId: null,
            bagWeightKg: 0,
            inputs: rawInputs.map((i) => ({ product: toProductOption(i.product), quantity: num(i.baseQuantity), batchNo: i.batchNo })),
            outputs: v.items.filter((i) => i.direction === 1).map((i) => {
              const rawBagId = (i as any).emptyBagProductId;
              const isNoBag = !rawBagId || rawBagId === "NONE";
              const emptyBagProdId = isNoBag ? null : rawBagId;
              const bagSize = !isNoBag && (i as any).bagSizeKg ? num((i as any).bagSizeKg) : null;
              const bCount = !isNoBag && (i as any).bagCount ? Number((i as any).bagCount) : (!isNoBag && (i as any).totalBags ? Number((i as any).totalBags) : null);
              return {
                product: toProductOption(i.product),
                quantity: num(i.baseQuantity),
                costShare: num(i.costShare ?? 0),
                batchNo: i.batchNo,
                emptyBagProductId: emptyBagProdId,
                bagSizeKg: bagSize,
                bagCount: bCount,
              };
            }),
          }}
        />
      </section>
    </>
  );
}

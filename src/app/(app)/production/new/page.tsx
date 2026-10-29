import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { toDateInput } from "@/lib/format";
import { requirePermission } from "@/server/auth";
import { canChangeEntryDate } from "@/server/entry-date";
import { readParams, type SearchParams } from "@/server/params";
import { saveProductionAction } from "@/server/actions/production";
import { productionFormData } from "@/server/services/production";
import { ProductionForm } from "../production-forms";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";

export const metadata: Metadata = { title: "নতুন উৎপাদন" };

export default async function NewProductionPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission(RICE_MILL_ACCESS.milling);
  const p = await readParams(searchParams);
  const data = await productionFormData(ctx.business.id);
  const recipe = data.recipes.find((r) => r.id === p.recipe) ?? (data.recipes.length === 1 ? data.recipes[0] : null);
  return (
    <>
      <PageHeader
        title="নতুন উৎপাদন এন্ট্রি"
        description="রেসিপি বেছে প্রধান কাঁচামালের পরিমাণ দিন — উৎপাদিত পণ্য, বাই-প্রোডাক্ট ও খরচ স্বয়ংক্রিয়ভাবে হিসাব হবে। সংরক্ষণ করলে স্টক সমন্বয় হবে।"
        crumbs={[{ label: "উৎপাদন", href: "/production" }, { label: "নতুন" }]}
      />
      <section className="panel p-5">
        <ProductionForm
          action={saveProductionAction.bind(null, null)}
          units={data.units}
          recipes={data.recipes}
          warehouses={data.warehouses}
          accounts={[]}
          currency={ctx.business.currencySymbol}
          dateLocked={!canChangeEntryDate(ctx)}
          multiWarehouse={ctx.features.includes("MULTI_WAREHOUSE")}
          defaults={recipe ? { date: toDateInput(), recipeId: recipe.id, warehouseId: null, reference: "", narration: "", extraCost: 0, costAccountId: "", inputs: recipe.inputs.map((l) => ({ ...l, batchNo: null })), outputs: recipe.outputs.map((l) => ({ ...l, batchNo: null })) } : null}
        />
      </section>
    </>
  );
}

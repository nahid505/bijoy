import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { saveRecipeAction } from "@/server/actions/production";
import { productionFormData } from "@/server/services/production";
import { RecipeForm } from "../../production-forms";

export const metadata: Metadata = { title: "নতুন রেসিপি" };

export default async function NewRecipePage() {
  const ctx = await requirePermission("production:manage");
  const { units } = await productionFormData(ctx.business.id);
  return (
    <>
      <PageHeader title="নতুন রেসিপি (BOM)" description="এক ব্যাচে কোন কাঁচামাল কতটা লাগে এবং কোন পণ্য ও বাই-প্রোডাক্ট কতটা পাওয়া যায়" crumbs={[{ label: "উৎপাদন", href: "/production" }, { label: "রেসিপি", href: "/production/recipes" }, { label: "নতুন" }]} />
      <section className="panel p-5"><RecipeForm action={saveRecipeAction.bind(null, null)} units={units} recipe={null} currency={ctx.business.currencySymbol} /></section>
    </>
  );
}

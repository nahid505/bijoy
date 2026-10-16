import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { deleteRecipeAction, saveRecipeAction } from "@/server/actions/production";
import { getRecipe, productionFormData, recipeData } from "@/server/services/production";
import { RecipeForm } from "../../production-forms";

export const metadata: Metadata = { title: "রেসিপি" };

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("production:view");
  const manage = can(ctx, "production:manage");
  const [recipe, { units }] = await Promise.all([getRecipe(ctx.business.id, id), productionFormData(ctx.business.id)]);
  if (!recipe) notFound();
  return (
    <>
      <PageHeader
        title={`রেসিপি: ${recipe.name}`}
        crumbs={[{ label: "উৎপাদন", href: "/production" }, { label: "রেসিপি", href: "/production/recipes" }, { label: recipe.name }]}
        actions={manage ? (
          <>
            {recipe.isActive && <Link prefetch={false} href={`/production/new?recipe=${recipe.id}`} className="btn-primary">এই রেসিপিতে উৎপাদন করুন</Link>}
            <ActionButton action={deleteRecipeAction.bind(null, recipe.id)} label="মুছুন" className="btn-danger" confirmText="রেসিপিটি মুছবেন? আগের উৎপাদন এন্ট্রি ও স্টক অপরিবর্তিত থাকবে।" />
          </>
        ) : undefined}
      />
      <section className="panel p-5">
        {manage ? <RecipeForm action={saveRecipeAction.bind(null, recipe.id)} units={units} recipe={recipeData(recipe)} currency={ctx.business.currencySymbol} /> : <p className="text-sm text-slate-600">শুধু দেখার অনুমতি আছে।</p>}
      </section>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { num } from "@/lib/db";
import { formatDate, formatQty, toBnDigits } from "@/lib/format";
import { processLoss, yieldPercent } from "@/lib/production";
import { ActionButton, PrintButton } from "@/components/forms";
import { PageHeader, PrintHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
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
      <div className="no-print">
        <PageHeader
          title={`রেসিপি: ${recipe.name}`}
          crumbs={[{ label: "উৎপাদন", href: "/production" }, { label: "রেসিপি", href: "/production/recipes" }, { label: recipe.name }]}
          actions={
            <>
              <PrintButton label="প্রিন্ট / PDF" />
              {manage && recipe.isActive && <Link prefetch={false} href={`/production/new?recipe=${recipe.id}`} className="btn-primary">এই রেসিপিতে উৎপাদন করুন</Link>}
              {manage && <ActionButton action={deleteRecipeAction.bind(null, recipe.id)} label="মুছুন" className="btn-danger" confirmText="রেসিপিটি মুছবেন? আগের উৎপাদন এন্ট্রি ও স্টক অপরিবর্তিত থাকবে।" />}
            </>
          }
        />
      </div>
      {/* editing on screen; on paper (and for those who may only look) the recipe sheet */}
      {manage && (
        <section className="panel no-print p-5">
          <RecipeForm action={saveRecipeAction.bind(null, recipe.id)} units={units} recipe={recipeData(recipe)} currency={ctx.business.currencySymbol} />
        </section>
      )}
      <RecipeSheet recipe={recipe} business={ctx.business} printOnly={manage} />
    </>
  );
}

type RecipeWithLines = NonNullable<Awaited<ReturnType<typeof getRecipe>>>;

/**
 * The recipe as a sheet: name, code, description; raw materials per batch; products and by-products per batch with
 * each one's share of the main raw material (চাল, কুঁড়া, ভূসি, খুদ …) and of the batch cost; process loss.
 */
async function RecipeSheet({ recipe, business, printOnly }: { recipe: RecipeWithLines; business: Parameters<typeof PrintHeader>[0]["business"]; printOnly: boolean }) {
  const t = await getT();
  const line = (l: RecipeWithLines["lines"][number]) => ({ id: l.id, name: l.product.name, unit: l.product.unit.name, unitId: l.product.unitId, quantity: num(l.quantity), costShare: num(l.costShare) });
  const inputs = recipe.lines.filter((l) => l.kind === "INPUT").map(line);
  const outputs = recipe.lines.filter((l) => l.kind === "OUTPUT").map(line);
  const main = inputs[0];
  const loss = processLoss(inputs, outputs);
  const pct = (n: number) => `${toBnDigits(n.toFixed(2))}%`;
  const cell = "border border-slate-300 px-2 py-1.5 print:border-slate-400";
  return (
    <section className={`panel recipe-sheet p-5 print:border-0 print:p-0 ${printOnly ? "print-only" : ""}`} id="recipe-sheet">
      <PrintHeader business={business} title={`${t("রেসিপি")}: ${recipe.name}`} subtitle={`${t("প্রিন্টের তারিখ")}: ${formatDate(new Date())}`} />
      <dl className="mb-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3 print:grid-cols-3 print:text-[11px]">
        <div><dt className="text-xs text-slate-500">{t("রেসিপির নাম")}</dt><dd className="font-semibold">{recipe.name}</dd></div>
        <div><dt className="text-xs text-slate-500">{t("কোড")}</dt><dd>{recipe.code || "—"}</dd></div>
        <div><dt className="text-xs text-slate-500">{t("অবস্থা")}</dt><dd>{t(recipe.isActive ? "সক্রিয়" : "নিষ্ক্রিয়")}</dd></div>
        {recipe.description && <div className="sm:col-span-3 print:col-span-3"><dt className="text-xs text-slate-500">{t("বিবরণ")}</dt><dd data-keep-lang>{recipe.description}</dd></div>}
      </dl>

      <h2 className="mb-1.5 text-sm font-bold text-ink-900">{t("কাঁচামাল (প্রতি ব্যাচ)")}</h2>
      <table className="mb-5 w-full border-collapse text-sm print:text-[11px]" id="recipe-inputs">
        <thead className="bg-slate-50 text-xs print:bg-white">
          <tr><th className={`${cell} w-10 text-center`}>{t("নং")}</th><th className={`${cell} text-left`}>{t("কাঁচামাল")}</th><th className={`${cell} w-48 text-right`}>{t("পরিমাণ")}</th></tr>
        </thead>
        <tbody>
          {inputs.map((l, i) => (
            <tr key={l.id}>
              <td className={`${cell} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
              <td className={cell}>{l.name}{i === 0 && <span className="ml-1 text-xs text-slate-500">({t("প্রধান কাঁচামাল")})</span>}</td>
              <td className={`${cell} text-right tabular-nums`}>{formatQty(l.quantity)} {l.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mb-1.5 text-sm font-bold text-ink-900">{t("উৎপাদিত পণ্য ও বাই-প্রোডাক্ট (প্রতি ব্যাচ)")}</h2>
      <table className="w-full border-collapse text-sm print:text-[11px]" id="recipe-outputs">
        <thead className="bg-slate-50 text-xs print:bg-white">
          <tr>
            <th className={`${cell} w-10 text-center`}>{t("নং")}</th>
            <th className={`${cell} text-left`}>{t("পণ্য")}</th>
            <th className={`${cell} w-40 text-right`}>{t("পরিমাণ")}</th>
            <th className={`${cell} w-40 text-right`}>{main ? t("শতকরা হার ({0}-এর)", { 0: main.name }) : t("শতকরা হার")}</th>
            <th className={`${cell} w-32 text-right`}>{t("খরচের ভাগ")}</th>
          </tr>
        </thead>
        <tbody>
          {outputs.map((l, i) => (
            <tr key={l.id}>
              <td className={`${cell} text-center tabular-nums`}>{toBnDigits(i + 1)}</td>
              <td className={cell}>{l.name}</td>
              <td className={`${cell} text-right tabular-nums`}>{formatQty(l.quantity)} {l.unit}</td>
              <td className={`${cell} text-right font-semibold tabular-nums`}>{main && main.unitId === l.unitId ? pct(yieldPercent(l.quantity, main.quantity)) : "—"}</td>
              <td className={`${cell} text-right tabular-nums`}>{pct(l.costShare)}</td>
            </tr>
          ))}
        </tbody>
        {loss && (
          <tfoot className="font-semibold">
            <tr>
              <td colSpan={2} className={`${cell} text-right`}>{t("মোট উৎপাদন")}</td>
              <td className={`${cell} text-right tabular-nums`}>{formatQty(loss.totalOut)} {outputs[0]?.unit}</td>
              <td className={`${cell} text-right tabular-nums`}>{pct(100 - loss.percent)}</td>
              <td className={cell} />
            </tr>
            <tr>
              <td colSpan={2} className={`${cell} text-right`}>{t("প্রসেস লস (ধুলা, আর্দ্রতা)")}</td>
              <td className={`${cell} text-right tabular-nums`}>{formatQty(loss.quantity)} {outputs[0]?.unit}</td>
              <td className={`${cell} text-right tabular-nums`}>{pct(loss.percent)}</td>
              <td className={cell} />
            </tr>
          </tfoot>
        )}
      </table>
      <p className="mt-3 text-xs text-slate-500 print:text-[10px]">{t("শতকরা হার = পণ্যের পরিমাণ ÷ প্রধান কাঁচামালের পরিমাণ × ১০০। উৎপাদনের সময় প্রধান কাঁচামালের পরিমাণ অনুযায়ী সব লাইন একই অনুপাতে বাড়ে-কমে।")}</p>
    </section>
  );
}

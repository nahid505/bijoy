"use server";

// Production management actions. Every action: permission (production:manage — refused while the
// Production feature is off or not in the plan) → validation → service → audit log.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { productionSchema, recipeSchema } from "@/lib/validation";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { flash } from "../flash";
import { guard, parseJsonPayload, toResult, type ActionState } from "../action-utils";
import { assertEntryDate, originalEntryDate } from "../entry-date";
import { createRiceMillTemplate, deleteRecipe, saveProduction, saveRecipe } from "../services/production";
import { voucherSnapshot } from "../services/voucher";

export async function saveRecipeAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("production:manage");
    const input = parseJsonPayload(recipeSchema, fd);
    const recipe = await saveRecipe(ctx.svc, input, id ?? undefined);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Recipe", entityId: recipe.id, details: { name: input.name, inputs: input.inputs, outputs: input.outputs } });
    return recipe;
  });
  if (!r.ok) return toResult(r);
  await flash(`রেসিপি "${r.data.name}" সংরক্ষণ হয়েছে`);
  revalidatePath("/production", "layout");
  redirect("/production/recipes");
}

export async function deleteRecipeAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("production:manage");
    const recipe = await deleteRecipe(ctx.svc, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "Recipe", entityId: id, details: { name: recipe.name } });
    return recipe;
  });
  if (!r.ok) return toResult(r);
  await flash(`রেসিপি "${r.data.name}" মুছে ফেলা হয়েছে — আগের উৎপাদন এন্ট্রিগুলো অপরিবর্তিত`);
  revalidatePath("/production", "layout");
  redirect("/production/recipes");
}

export async function riceMillTemplateAction(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("production:manage");
    const res = await createRiceMillTemplate(ctx.svc);
    if (res.created) await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "Recipe", entityId: res.recipeId, details: { template: "rice-mill" } });
    return res;
  });
  if (!r.ok) return toResult(r);
  await flash(r.data.created ? "রাইস মিল রেসিপি তৈরি হয়েছে — ধান, চাল, খুদ, কুঁড়া ও তুষ পণ্যসহ। নিজের মিলের ফলন অনুযায়ী পরিমাণ মিলিয়ে নিন।" : "রাইস মিল রেসিপি আগে থেকেই আছে");
  revalidatePath("/production", "layout");
  redirect(`/production/recipes/${r.data.recipeId}`);
}

export async function saveProductionAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("production:manage");
    const input = parseJsonPayload(productionSchema, fd);
    assertEntryDate(ctx, input.date, await originalEntryDate(ctx.business.id, id));
    if (!id && !ctx.features.includes("MULTI_WAREHOUSE")) input.warehouseId = null; // → main warehouse
    const before = id ? await voucherSnapshot(ctx.business.id, id) : null;
    const v = await saveProduction(ctx.svc, input, id ?? undefined);
    await audit({
      businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Voucher", entityId: v.id,
      details: { type: "PRODUCTION", voucherNo: v.voucherNo, recipeId: input.recipeId, inputs: input.inputs, outputs: input.outputs, extraCost: input.extraCost, ...(before ? { before } : {}) },
    });
    return v;
  });
  if (!r.ok) return toResult(r);
  await flash(`উৎপাদন এন্ট্রি ${r.data.voucherNo} সংরক্ষণ হয়েছে — কাঁচামাল ও উৎপাদিত পণ্যের স্টক সমন্বয় হয়েছে`);
  revalidatePath("/", "layout");
  redirect(`/vouchers/v/${r.data.id}`);
}

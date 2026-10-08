"use server";

// Company billing: checkout, manual payment reference, switch to the free plan, auto-renew.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { guard, toResult, UserError, type ActionState } from "../action-utils";
import { flash } from "../flash";
import { appBaseUrl } from "../billing/base-url";
import { startCheckout, submitManualReference } from "../billing/checkout";
import { changePlan, platformSettings, setAutoRenew } from "../services/subscriptions";

const checkoutSchema = z.object({
  planId: z.string().min(1, "প্ল্যান নির্বাচন করুন"),
  cycle: z.enum(["MONTHLY", "YEARLY"]),
  provider: z.string().min(1, "পেমেন্ট মাধ্যম নির্বাচন করুন").max(30),
});

export async function startCheckoutAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("billing:manage");
    const input = checkoutSchema.parse({ planId: fd.get("planId"), cycle: fd.get("cycle"), provider: fd.get("provider") });
    const res = await startCheckout({ businessId: ctx.business.id, userId: ctx.user.id, ...input, baseUrl: await appBaseUrl() });
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "Payment", entityId: res.transaction.id, details: { event: "checkout", planId: input.planId, cycle: input.cycle, provider: input.provider, amount: Number(res.transaction.amount) } });
    return res.redirectUrl;
  });
  if (!r.ok) return toResult(r);
  redirect(r.data);
}

export async function submitManualPaymentAction(transactionId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("billing:manage");
    const t = await submitManualReference(ctx.business.id, transactionId, String(fd.get("reference") ?? ""));
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Payment", entityId: t.id, details: { event: "manual-reference", reference: t.manualReference } });
  });
  if (!r.ok) return toResult(r);
  await flash("পেমেন্টের তথ্য জমা হয়েছে — যাচাইয়ের পর সাবস্ক্রিপশন চালু হবে");
  redirect(`/billing/result?txn=${transactionId}&outcome=PENDING`);
}

/** Moves to the free (fallback) plan — no payment; paid features close, data stays. */
export async function switchToFreePlanAction(_prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("billing:manage");
    const s = await platformSettings();
    const free = await prisma.plan.findUnique({ where: { code: s.fallbackPlanCode } });
    if (!free) throw new UserError("ফ্রি প্ল্যান পাওয়া যায়নি");
    await changePlan(ctx.business.id, free.id, { actorUserId: ctx.user.id, endDate: null, note: "company switched to the free plan" });
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Subscription", entityId: ctx.business.id, details: { event: "switch-to-free", plan: free.code } });
  });
  if (!r.ok) return toResult(r);
  await flash("ফ্রি প্ল্যানে পরিবর্তন হয়েছে — সব তথ্য সংরক্ষিত আছে");
  revalidatePath("/", "layout");
  redirect("/billing");
}

export async function setAutoRenewAction(on: boolean, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("billing:manage");
    await setAutoRenew(ctx.business.id, on, ctx.user.id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "Subscription", entityId: ctx.business.id, details: { event: on ? "auto-renew-on" : "auto-renew-off" } });
  });
  if (!r.ok) return toResult(r);
  revalidatePath("/billing");
  return { ok: true, message: on ? "স্বয়ংক্রিয় নবায়ন চালু হয়েছে" : "স্বয়ংক্রিয় নবায়ন বন্ধ হয়েছে" };
}

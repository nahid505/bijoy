"use server";

// Super Admin actions (platform scope). Every action: super-admin check → validation → service →
// audit log (with the affected company).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, num } from "@/lib/db";
import { audit } from "../audit";
import { guard, parseJsonPayload, toResult, UserError, type ActionState } from "../action-utils";
import { flash } from "../flash";
import { assertSuperAdmin } from "../super-admin";
import { deletePlan, refundPayment, savePlan, savePlatformSettings, setFeatureOverride } from "../services/platform-admin";
import { changePlan, extendSubscription, failPayment, finalizePayment, suspendSubscription } from "../services/subscriptions";

const back = (_businessId: string, message: string): ActionState => ({ ok: true, message });
const done = async (message: string, path: string) => {
  await flash(message);
  revalidatePath("/admin", "layout");
  redirect(path);
};

export async function adminChangePlanAction(businessId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const admin = await assertSuperAdmin();
    const input = z.object({ planId: z.string().min(1, "প্ল্যান নির্বাচন করুন"), cycle: z.enum(["MONTHLY", "YEARLY"]), endDate: z.string().optional(), note: z.string().max(300).optional() }).parse(Object.fromEntries(fd));
    const endDate = input.endDate ? new Date(`${input.endDate}T00:00:00.000Z`) : undefined;
    if (endDate && Number.isNaN(endDate.getTime())) throw new UserError("সঠিক তারিখ দিন");
    const sub = await changePlan(businessId, input.planId, { cycle: input.cycle, endDate, actorUserId: admin.id, note: input.note || "super admin" });
    await audit({ businessId, userId: admin.id, action: "UPDATE", entity: "Subscription", entityId: sub.id, details: { event: "admin-plan-change", planId: input.planId, cycle: input.cycle, endDate: input.endDate ?? null, note: input.note ?? null } });
  });
  if (!r.ok) return toResult(r);
  return done("প্ল্যান পরিবর্তন হয়েছে", `/admin/companies/${businessId}`);
}

export async function adminExtendAction(businessId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const admin = await assertSuperAdmin();
    const input = z.object({ days: z.coerce.number().int().min(1).max(3650), note: z.string().max(300).optional() }).parse(Object.fromEntries(fd));
    const sub = await extendSubscription(businessId, input.days, { actorUserId: admin.id, note: input.note || null });
    await audit({ businessId, userId: admin.id, action: "UPDATE", entity: "Subscription", entityId: sub.id, details: { event: "admin-extend", days: input.days, note: input.note ?? null } });
  });
  if (!r.ok) return toResult(r);
  return done("মেয়াদ বাড়ানো হয়েছে", `/admin/companies/${businessId}`);
}

export async function adminSuspendAction(businessId: string, suspend: boolean, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const admin = await assertSuperAdmin();
    const reason = String(fd.get("reason") ?? "").trim().slice(0, 300) || null;
    const sub = await suspendSubscription(businessId, suspend, { actorUserId: admin.id, reason });
    await audit({ businessId, userId: admin.id, action: "UPDATE", entity: "Subscription", entityId: sub.id, details: { event: suspend ? "admin-suspend" : "admin-resume", reason } });
  });
  if (!r.ok) return toResult(r);
  return done(suspend ? "সাবস্ক্রিপশন স্থগিত হয়েছে" : "সাবস্ক্রিপশন আবার চালু হয়েছে", `/admin/companies/${businessId}`);
}

export async function adminFeatureOverrideAction(businessId: string, featureKey: string, value: "on" | "off" | "plan", _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const admin = await assertSuperAdmin();
    if (!(await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }))) throw new UserError("কোম্পানি পাওয়া যায়নি");
    await setFeatureOverride(businessId, featureKey, value === "plan" ? null : value === "on", admin.id);
    await audit({ businessId, userId: admin.id, action: "UPDATE", entity: "Feature", entityId: featureKey, details: { event: "admin-override", value } });
  });
  if (!r.ok) return toResult(r);
  revalidatePath(`/admin/companies/${businessId}`);
  return back(businessId, "ফিচার পরিবর্তন হয়েছে");
}

export async function adminApprovePaymentAction(transactionId: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const admin = await assertSuperAdmin();
    const t = await prisma.paymentTransaction.findUnique({ where: { id: transactionId } });
    if (!t) throw new UserError("লেনদেন পাওয়া যায়নি");
    if (t.provider !== "manual" || t.status !== "PENDING") throw new UserError("শুধু যাচাইয়ের অপেক্ষায় থাকা ম্যানুয়াল পেমেন্ট অনুমোদন করা যায়");
    const res = await finalizePayment(t.id, { providerTrxId: t.manualReference, amount: num(t.amount), raw: { verifiedBy: admin.id } }, { verifiedById: admin.id });
    await audit({ businessId: t.businessId, userId: admin.id, action: "UPDATE", entity: "Payment", entityId: t.id, details: { event: "admin-approve", reference: t.manualReference, amount: num(t.amount), invoice: res.invoice?.number ?? null } });
  });
  if (!r.ok) return toResult(r);
  revalidatePath("/admin", "layout");
  return { ok: true, message: "পেমেন্ট অনুমোদিত — সাবস্ক্রিপশন চালু হয়েছে" };
}

export async function adminRejectPaymentAction(transactionId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const admin = await assertSuperAdmin();
    const t = await prisma.paymentTransaction.findUnique({ where: { id: transactionId } });
    if (!t) throw new UserError("লেনদেন পাওয়া যায়নি");
    const reason = String(fd.get("reason") ?? "").trim() || "যাচাইয়ে টাকা পাওয়া যায়নি";
    if (!(await failPayment(t.id, reason, { actorUserId: admin.id }))) throw new UserError("এই পেমেন্ট আর পরিবর্তন করা যায় না");
    await audit({ businessId: t.businessId, userId: admin.id, action: "UPDATE", entity: "Payment", entityId: t.id, details: { event: "admin-reject", reason } });
  });
  if (!r.ok) return toResult(r);
  revalidatePath("/admin", "layout");
  return { ok: true, message: "পেমেন্ট প্রত্যাখ্যান করা হয়েছে" };
}

export async function adminRefundPaymentAction(transactionId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const admin = await assertSuperAdmin();
    const reason = String(fd.get("reason") ?? "").trim().slice(0, 200);
    if (reason.length < 3) throw new UserError("রিফান্ডের কারণ লিখুন", { reason: ["রিফান্ডের কারণ লিখুন"] });
    const t = await refundPayment(transactionId, reason, admin.id);
    await audit({ businessId: t.businessId, userId: admin.id, action: "UPDATE", entity: "Payment", entityId: t.id, details: { event: "admin-refund", reason, amount: num(t.amount) } });
  });
  if (!r.ok) return toResult(r);
  revalidatePath("/admin", "layout");
  return { ok: true, message: "রিফান্ড রেকর্ড হয়েছে — প্রয়োজনে প্ল্যান পরিবর্তন বা স্থগিত করুন" };
}

const planSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/, "কোড: ইংরেজি বড় হাতের অক্ষর, সংখ্যা ও _"),
  nameBn: z.string().trim().min(1, "নাম আবশ্যক").max(60),
  nameEn: z.string().trim().min(1, "নাম আবশ্যক").max(60),
  descriptionBn: z.string().trim().max(300).nullable().transform((v) => v || null),
  descriptionEn: z.string().trim().max(300).nullable().transform((v) => v || null),
  priceMonthly: z.coerce.number().min(0).max(10_000_000),
  priceYearly: z.coerce.number().min(0).max(100_000_000),
  userLimit: z.union([z.null(), z.coerce.number().int().min(1).max(100_000)]),
  isActive: z.boolean(),
  isPublic: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(9999),
  features: z.array(z.string()).max(100),
});

export async function adminSavePlanAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const admin = await assertSuperAdmin();
    const input = parseJsonPayload(planSchema, fd);
    const plan = await savePlan(input, id ?? undefined);
    await audit({ businessId: null, userId: admin.id, action: id ? "UPDATE" : "CREATE", entity: "Plan", entityId: plan.id, details: { ...input } });
    return plan;
  });
  if (!r.ok) return toResult(r);
  return done("প্ল্যান সংরক্ষণ হয়েছে", "/admin/plans");
}

export async function adminDeletePlanAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const admin = await assertSuperAdmin();
    const p = await deletePlan(id);
    await audit({ businessId: null, userId: admin.id, action: "DELETE", entity: "Plan", entityId: id, details: { code: p.code } });
  });
  if (!r.ok) return toResult(r);
  return done("প্ল্যান মুছে ফেলা হয়েছে", "/admin/plans");
}

export async function adminSaveSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const admin = await assertSuperAdmin();
    const input = z.object({
      trialDays: z.coerce.number().int().min(0).max(365),
      trialPlanCode: z.string().trim().min(1),
      fallbackPlanCode: z.string().trim().min(1),
      graceDays: z.coerce.number().int().min(0).max(90),
      reminderDays: z.string().transform((v) => v.split(/[,\s]+/).filter(Boolean).map(Number)).pipe(z.array(z.number().int().min(1).max(90)).max(6)),
      vatPercent: z.coerce.number().min(0).max(50),
      currency: z.string().trim().min(3).max(3),
      invoicePrefix: z.string().trim().regex(/^[A-Za-z0-9-]{1,10}$/, "শুধু ইংরেজি অক্ষর, সংখ্যা ও -"),
    }).parse(Object.fromEntries(fd));
    await savePlatformSettings(input);
    await audit({ businessId: null, userId: admin.id, action: "UPDATE", entity: "PlatformSetting", entityId: "platform", details: { ...input } });
  });
  if (!r.ok) return toResult(r);
  revalidatePath("/admin", "layout");
  return { ok: true, message: "প্ল্যাটফর্ম সেটিং সংরক্ষণ হয়েছে" };
}

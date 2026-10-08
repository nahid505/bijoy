"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, can, getContext } from "../auth";
import { audit } from "../audit";
import { flash } from "../flash";
import { formToObject, guard, toResult, UserError, type ActionState } from "../action-utils";
import { writeOffExpired } from "../services/voucher";
import { businessToday, markRead, runDailyChecks, visibleKinds } from "../services/notifications";
import { assertFeature } from "../features";

/** Writes off the selected expired batches (or every expired batch) and opens the posted voucher. */
export async function writeOffExpiredAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("stock:adjust");
    await assertFeature(ctx.business.id, "PRODUCT_EXPIRY");
    const ids = fd.getAll("batchId").map(String).filter(Boolean);
    if (ids.length === 0) throw new UserError("বাতিল করার জন্য অন্তত একটি মেয়াদোত্তীর্ণ ব্যাচ নির্বাচন করুন");
    const v = await writeOffExpired(ctx.svc, { date: businessToday(), batchIds: ids });
    await runDailyChecks(ctx.business.id, { force: true }); // resolve the alerts of the written-off batches now
    return v;
  });
  if (!result.ok) return toResult(result);
  await flash(`মেয়াদোত্তীর্ণ মজুদ বাতিল হয়েছে — ${result.data.voucherNo}`);
  revalidatePath("/", "layout");
  redirect(`/vouchers/v/${result.data.id}`);
}

const batchEditSchema = z
  .object({
    mfgDate: z.union([z.literal(""), z.coerce.date()]).transform((v) => (v instanceof Date ? v : null)),
    expiryDate: z.union([z.literal(""), z.coerce.date()]).transform((v) => (v instanceof Date ? v : null)),
    salePrice: z.coerce.number().min(0, "ঋণাত্মক হতে পারবে না"),
  })
  .refine((v) => !v.mfgDate || !v.expiryDate || v.mfgDate <= v.expiryDate, { message: "উৎপাদনের তারিখ মেয়াদ শেষের পরে হতে পারে না", path: ["mfgDate"] });

/** Corrects a batch's dates / sale price (e.g. a typo on the purchase). Audited. */
export async function updateBatchAction(batchId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("inventory:manage");
    const input = batchEditSchema.parse(formToObject(fd));
    const before = await prisma.productBatch.findFirst({ where: { id: batchId, businessId: ctx.business.id } });
    if (!before) throw new UserError("ব্যাচ পাওয়া যায়নি");
    await prisma.$transaction(async (tx) => {
      await tx.productBatch.update({ where: { id: batchId }, data: input });
      // keep the denormalised expiry on stock lines in step with the batch
      await tx.stockMovement.updateMany({ where: { batchId }, data: { expiryDate: input.expiryDate } });
      await tx.voucherItem.updateMany({ where: { batchId }, data: { expiryDate: input.expiryDate } });
    });
    await audit({
      businessId: ctx.business.id, userId: ctx.user.id, action: "UPDATE", entity: "ProductBatch", entityId: batchId,
      details: {
        batchNo: before.batchNo,
        before: { mfgDate: before.mfgDate?.toISOString().slice(0, 10) ?? null, expiryDate: before.expiryDate?.toISOString().slice(0, 10) ?? null, salePrice: Number(before.salePrice) },
        after: { mfgDate: input.mfgDate?.toISOString().slice(0, 10) ?? null, expiryDate: input.expiryDate?.toISOString().slice(0, 10) ?? null, salePrice: input.salePrice },
      },
    });
    await runDailyChecks(ctx.business.id, { force: true });
  });
  revalidatePath("/", "layout");
  return result.ok ? { ok: true, message: "ব্যাচের তথ্য সংরক্ষণ হয়েছে" } : toResult(result);
}

/** Re-runs today's check immediately (also done automatically every day). */
export async function runChecksNowAction(_prev?: ActionState, _fd?: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await getContext();
    if (!ctx || visibleKinds((p) => can(ctx, p as never), ctx.features).length === 0) throw new UserError("অনুমতি নেই");
    return runDailyChecks(ctx.business.id, { force: true });
  });
  revalidatePath("/", "layout");
  if (!result.ok) return toResult(result);
  const r = result.data;
  return { ok: true, message: `যাচাই সম্পন্ন — নতুন ${r.created}, সমাধান হয়েছে ${r.resolved}, সক্রিয় ${r.active}` };
}

/** Marks alerts as read for the current user. They stay in the list and in history. */
export async function markNotificationsReadAction(ids: string[] | null, _prev?: ActionState, _fd?: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await getContext();
    if (!ctx) throw new UserError("অনুমতি নেই");
    return markRead(ctx.business.id, ctx.user.id, visibleKinds((p) => can(ctx, p as never), ctx.features), ids ?? undefined);
  });
  revalidatePath("/", "layout");
  return result.ok ? { ok: true } : toResult(result);
}

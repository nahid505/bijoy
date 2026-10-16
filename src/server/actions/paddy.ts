"use server";

// Paddy purchase (weighbridge slip) — permission purchases:create / purchases:edit (closed when the
// Purchase feature is not in the plan) → validation → service → audit log.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { paddyPurchaseSchema } from "@/lib/validation";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { flash } from "../flash";
import { guard, parseJsonPayload, toResult, type ActionState } from "../action-utils";
import { assertEntryDate, originalEntryDate } from "../entry-date";
import { savePaddyPurchase } from "../services/paddy";
import { voucherSnapshot } from "../services/voucher";

export async function savePaddyPurchaseAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission(id ? "purchases:edit" : "purchases:create");
    const input = parseJsonPayload(paddyPurchaseSchema, fd);
    assertEntryDate(ctx, input.date, await originalEntryDate(ctx.business.id, id));
    if (!id && !ctx.features.includes("MULTI_WAREHOUSE")) input.warehouseId = null; // → main warehouse
    const before = id ? await voucherSnapshot(ctx.business.id, id) : null;
    const v = await savePaddyPurchase(ctx.svc, input, id ?? undefined);
    await audit({
      businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Voucher", entityId: v.id,
      details: { type: "PURCHASE", paddy: { bagCount: input.bagCount, grossKg: input.grossKg, dhaltaKg: input.dhaltaKg, ratePerMon: input.ratePerMon, notes: input.notes }, voucherNo: v.voucherNo, ...(before ? { before } : {}) },
    });
    return v;
  });
  if (!r.ok) return toResult(r);
  await flash(`ধান ক্রয় ${r.data.voucherNo} সংরক্ষণ হয়েছে — নিট ওজন স্টকে যোগ হয়েছে`);
  revalidatePath("/", "layout");
  redirect(`/vouchers/v/${r.data.id}`);
}

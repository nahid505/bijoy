"use server";

// Depot management (business type DEPOT): delivery challans (sales:create / sales:edit) and commission
// settlement (vouchers:create). The service refuses non-depot businesses as well.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEPOT_ACCESS, DEPOT_MODE_SHORT } from "@/lib/depot";
import { commissionSettlementSchema, commissionTransferSchema, depotDeliverySchema } from "@/lib/validation";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { flash } from "../flash";
import { formToObject, guard, parseJsonPayload, toResult, type ActionState } from "../action-utils";
import { assertEntryDate, originalEntryDate } from "../entry-date";
import { saveDepotDelivery, settleCommission, transferCommission } from "../services/depot";
import { voucherSnapshot } from "../services/voucher";
import { assertPartiesAllowed, assertVoucherAllowed } from "../party-scope";

export async function saveDepotDeliveryAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission(id ? DEPOT_ACCESS.deliveryEdit : DEPOT_ACCESS.deliveryCreate);
    const input = parseJsonPayload(depotDeliverySchema, fd);
    await assertVoucherAllowed(ctx, id);
    await assertPartiesAllowed(ctx, [input.dealerAccountId, input.companyAccountId, input.cashAccountId]);
    assertEntryDate(ctx, input.date, await originalEntryDate(ctx.business.id, id));
    if (!id && !ctx.features.includes("MULTI_WAREHOUSE")) input.warehouseId = null; // → main warehouse
    const before = id ? await voucherSnapshot(ctx.business.id, id) : null;
    const v = await saveDepotDelivery(ctx.svc, input, id ?? undefined);
    await audit({
      businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Voucher", entityId: v.id,
      details: { type: v.type, depot: { mode: input.mode, doNumber: input.doNumber, lines: input.lines.length }, voucherNo: v.voucherNo, ...(before ? { before } : {}) },
    });
    return { v, mode: input.mode };
  });
  if (!r.ok) return toResult(r);
  await flash(`ডেলিভারি চালান ${r.data.v.voucherNo} (${DEPOT_MODE_SHORT[r.data.mode]}) সংরক্ষণ হয়েছে`);
  revalidatePath("/", "layout");
  if (fd.get("then") === "print") redirect(`/depot/deliveries/${r.data.v.id}/print`); // dealer copy
  redirect(`/vouchers/v/${r.data.v.id}`);
}

export async function settleCommissionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission(DEPOT_ACCESS.settle);
    const input = commissionSettlementSchema.parse(formToObject(fd));
    await assertPartiesAllowed(ctx, [input.companyAccountId, input.cashAccountId]);
    assertEntryDate(ctx, input.date);
    const v = await settleCommission(ctx.svc, input);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "Voucher", entityId: v.id, details: { depotCommission: { companyAccountId: input.companyAccountId, amount: input.amount, method: input.method }, voucherNo: v.voucherNo } });
    return v;
  });
  if (!r.ok) return toResult(r);
  await flash(`কমিশন ${r.data.voucherNo} সংরক্ষণ হয়েছে`);
  revalidatePath("/", "layout");
  redirect("/depot/commission");
}

/** Depot commission → general income (it posts to the general books, so it needs the general voucher permission). */
export async function transferCommissionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("vouchers:create");
    const input = commissionTransferSchema.parse(formToObject(fd));
    await assertPartiesAllowed(ctx, [input.depotCashAccountId, input.generalCashAccountId]);
    assertEntryDate(ctx, input.date);
    const v = await transferCommission(ctx.svc, input);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "Voucher", entityId: v.general.id, details: { depotCommissionTransfer: { amount: input.amount }, depotVoucher: v.depot.voucherNo, generalVoucher: v.general.voucherNo } });
    return v;
  });
  if (!r.ok) return toResult(r);
  await flash(`কমিশন সাধারণ আয়ে স্থানান্তর হয়েছে — ডিপো ${r.data.depot.voucherNo}, সাধারণ ${r.data.general.voucherNo}`);
  revalidatePath("/", "layout");
  redirect("/depot/commission");
}

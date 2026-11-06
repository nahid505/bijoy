"use server";

// Depot cash ("ডিপো ক্যাশ") and depot expenses: expenses need depot:expense_manage; the fund transfer moves the
// main cash / bank, so it needs the general voucher permission. Both post to the general book.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEPOT_ACCESS } from "@/lib/depot";
import { depotExpenseSchema, depotFundSchema } from "@/lib/validation";
import { assertPermission, can, getContext } from "../auth";
import { audit } from "../audit";
import { flash } from "../flash";
import { formToObject, guard, toResult, UserError, type ActionState } from "../action-utils";
import { assertEntryDate, originalEntryDate } from "../entry-date";
import { deleteDepotExpense, loadDepotExpense, saveDepotExpense, transferDepotFund } from "../services/depot-cash";
import { voucherSnapshot } from "../services/voucher";
import { prisma } from "@/lib/db";
import { assertPartiesAllowed, assertVoucherAllowed } from "../party-scope";

export async function saveDepotExpenseAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const required = id ? DEPOT_ACCESS.expenseEdit : DEPOT_ACCESS.expenseCreate;
    const base = await getContext();
    if (!base || !can(base, required)) {
      throw new UserError("এই খরচ এন্ট্রি বা দেখার আপনার অনুমতি নেই");
    }
    const ctx = await assertPermission(required);
    const input = depotExpenseSchema.parse(formToObject(fd));
    if (Number(input.amount) > 50000 && !can(ctx, "expense:max_limit_override") && !ctx.isOwner) {
      throw new UserError("এই অঙ্কের অতিরিক্ত খরচ এন্ট্রি করার অনুমতি নেই (expense:max_limit_override প্রয়োজন)");
    }
    if (id) await loadDepotExpense(prisma, ctx.business.id, id); // a depot expense, nothing else
    await assertVoucherAllowed(ctx, id); // a restricted user edits only what they can see
    await assertPartiesAllowed(ctx, [input.expenseAccountId, input.cashAccountId]);
    assertEntryDate(ctx, input.date, await originalEntryDate(ctx.business.id, id));
    const before = id ? await voucherSnapshot(ctx.business.id, id) : null;
    const v = await saveDepotExpense(ctx.svc, input, id ?? undefined);
    await audit({
      businessId: ctx.business.id, userId: ctx.user.id, action: id ? "UPDATE" : "CREATE", entity: "Voucher", entityId: v.id,
      details: { type: v.type, depotExpense: { expenseAccountId: input.expenseAccountId, cashAccountId: input.cashAccountId, amount: input.amount }, voucherNo: v.voucherNo, ...(before ? { before } : {}) },
    });
    return v;
  });
  if (!r.ok) return toResult(r);
  await flash(`ডিপো খরচ ${r.data.voucherNo} সংরক্ষণ হয়েছে`);
  revalidatePath("/", "layout");
  redirect(fd.get("then") === "new" ? "/depot/expenses/new" : "/depot/expenses");
}

export async function deleteDepotExpenseAction(id: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const base = await getContext();
    if (!base || !can(base, DEPOT_ACCESS.expenseDelete)) {
      throw new UserError("এই খরচ এন্ট্রি বা দেখার আপনার অনুমতি নেই");
    }
    const ctx = await assertPermission(DEPOT_ACCESS.expenseDelete);
    const old = await loadDepotExpense(prisma, ctx.business.id, id);
    await assertVoucherAllowed(ctx, id);
    assertEntryDate(ctx, old.date);
    const before = await voucherSnapshot(ctx.business.id, id);
    const v = await deleteDepotExpense(ctx.svc, id);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "DELETE", entity: "Voucher", entityId: id, details: { depotExpense: true, voucherNo: v.voucherNo, before } });
    return v;
  });
  if (!r.ok) return toResult(r);
  await flash(`ডিপো খরচ ${r.data.voucherNo} মুছে ফেলা হয়েছে`);
  revalidatePath("/", "layout");
  redirect("/depot/expenses");
}

export async function transferDepotFundAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission(DEPOT_ACCESS.fund);
    const input = depotFundSchema.parse(formToObject(fd));
    await assertPartiesAllowed(ctx, [input.mainAccountId]);
    assertEntryDate(ctx, input.date);
    const v = await transferDepotFund(ctx.svc, input);
    await audit({ businessId: ctx.business.id, userId: ctx.user.id, action: "CREATE", entity: "Voucher", entityId: v.id, details: { depotFund: { direction: input.direction, mainAccountId: input.mainAccountId, amount: input.amount }, voucherNo: v.voucherNo } });
    return v;
  });
  if (!r.ok) return toResult(r);
  await flash(`ফান্ড স্থানান্তর ${r.data.voucherNo} সংরক্ষণ হয়েছে`);
  revalidatePath("/", "layout");
  redirect("/depot/expenses");
}

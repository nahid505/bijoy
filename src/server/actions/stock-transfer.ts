"use server";

import { revalidatePath } from "next/cache";
import { guard, parseJsonPayload, toResult, type ActionState } from "../action-utils";
import { assertPermission } from "../auth";
import { flash } from "../flash";
import { stockTransferSchema } from "@/lib/validation";
import { createStockTransfer, deleteStockTransfer } from "../services/stock-transfer";

export async function saveStockTransferAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("inventory:manage");
    const input = parseJsonPayload(stockTransferSchema, fd);
    const res = await createStockTransfer(ctx.svc, input);
    await flash(`গুদাম মাল হস্তান্তর সফলভাবে সম্পন্ন হয়েছে (চালান: ${res.transferNo})`);
    return res;
  });
  if (!result.ok) return toResult(result);
  revalidatePath("/products/stock-transfer");
  revalidatePath("/products/stock");
  revalidatePath("/products");
  return { ok: true, data: { transferNo: result.data.transferNo } };
}

export async function deleteStockTransferAction(transferId: string, _prev: ActionState, _fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission("inventory:manage");
    await deleteStockTransfer(ctx.svc, transferId);
    await flash("মাল হস্তান্তর সফলভাবে বাতিল ও স্টক রিভার্স করা হয়েছে");
  });
  if (!result.ok) return toResult(result);
  revalidatePath("/products/stock-transfer");
  revalidatePath("/products/stock");
  revalidatePath("/products");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bagReturnSchema } from "@/lib/validation";
import { assertPermission, requirePermission } from "../auth";
import { audit } from "../audit";
import { flash } from "../flash";
import { guard, parseJsonPayload, toResult, type ActionState } from "../action-utils";
import { assertEntryDate } from "../entry-date";
import { deleteBagReturnVoucher, getSupplierBagBalance, saveBagReturnVoucher, type SupplierBagBalance } from "../services/bag-tracking";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";

export async function fetchSupplierBagBalanceAction(supplierId: string): Promise<SupplierBagBalance | null> {
  const ctx = await requirePermission("auto_rice_mill:bag_return:view");
  if (!supplierId) return null;
  return getSupplierBagBalance(ctx.business.id, supplierId);
}

export async function saveBagReturnAction(id: string | null, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("auto_rice_mill:bag_return:create");
    const input = parseJsonPayload(bagReturnSchema, fd);
    assertEntryDate(ctx, new Date(input.date));

    const voucher = await saveBagReturnVoucher(ctx.svc, input, id ?? undefined);
    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: id ? "UPDATE" : "CREATE",
      entity: "BagReturnVoucher",
      entityId: voucher.id,
      details: {
        voucherNo: voucher.voucherNo,
        supplierId: input.supplierId,
        returnedJuteBags: input.returnedJuteBags,
        returnedPlasticBags: input.returnedPlasticBags,
      },
    });
    return voucher;
  });

  if (!r.ok) return toResult(r);
  await flash(`বস্তা ফেরত চালান ${r.data.voucherNo} সংরক্ষণ হয়েছে`);
  revalidatePath("/", "layout");
  redirect(`/auto-rice-mill/bag-returns/${r.data.id}`);
}

export async function deleteBagReturnAction(id: string): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission("auto_rice_mill:bag_return:create");
    const voucher = await deleteBagReturnVoucher(ctx.svc, id);
    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "DELETE",
      entity: "BagReturnVoucher",
      entityId: id,
      details: { voucherNo: voucher.voucherNo },
    });
    return voucher;
  });

  if (!r.ok) return toResult(r);
  await flash(`বস্তা ফেরত চালান ${r.data.voucherNo} মুছে ফেলা হয়েছে`);
  revalidatePath("/", "layout");
  redirect(`/auto-rice-mill/bag-returns`);
}

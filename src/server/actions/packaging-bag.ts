"use server";

import { revalidatePath } from "next/cache";
import { packagingBagItemSchema, packagingBagWastageSchema } from "@/lib/validation";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { flash } from "../flash";
import { guard, parseJsonPayload, toResult, type ActionState } from "../action-utils";
import { assertEntryDate } from "../entry-date";
import {
  deletePackagingBagItem,
  recordPackagingBagWastage,
  savePackagingBagItem,
} from "../services/packaging-bag";
import { RICE_MILL_ACCESS } from "@/lib/rice-mill";

export async function savePackagingBagItemAction(
  id: string | null,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission(RICE_MILL_ACCESS.stock);
    const input = parseJsonPayload(packagingBagItemSchema, fd);

    const item = await savePackagingBagItem(ctx.svc, input, id ?? undefined);
    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: id ? "UPDATE" : "CREATE",
      entity: "PackagingBagItem",
      entityId: item.id,
      details: {
        name: input.name,
        bagType: input.bagType,
        capacityKg: input.capacityKg,
      },
    });
    return item;
  });

  if (!r.ok) return toResult(r);
  await flash(`খালি বস্তা "${r.data.bagType}" সফলভাবে সংরক্ষণ করা হয়েছে`);
  revalidatePath("/auto-rice-mill/bag-inventory");
  return { ok: true, data: { id: r.data.id } };
}

export async function recordPackagingBagWastageAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission(RICE_MILL_ACCESS.stock);
    const input = parseJsonPayload(packagingBagWastageSchema, fd);
    assertEntryDate(ctx, new Date(input.date));

    const wastage = await recordPackagingBagWastage(ctx.svc, input);
    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "PackagingBagWastage",
      entityId: wastage.id,
      details: {
        bagItemId: input.bagItemId,
        quantity: input.quantity,
        warehouseId: input.warehouseId,
        costAmount: Number(wastage.costAmount),
        reason: input.reason,
      },
    });
    return wastage;
  });

  if (!r.ok) return toResult(r);
  await flash(`নষ্ট বস্তার এন্ট্রি (${r.data.quantity} টি) সংরক্ষণ হয়েছে এবং স্টক সমন্বয় করা হয়েছে`);
  revalidatePath("/auto-rice-mill/bag-inventory");
  return { ok: true, data: { id: r.data.id } };
}

export async function deletePackagingBagItemAction(id: string): Promise<ActionState> {
  const r = await guard(async () => {
    const ctx = await assertPermission(RICE_MILL_ACCESS.stock);
    const deleted = await deletePackagingBagItem(ctx.svc, id);
    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "DELETE",
      entity: "PackagingBagItem",
      entityId: id,
      details: { id },
    });
    return deleted;
  });

  if (!r.ok) return toResult(r);
  await flash("খালি বস্তা সফলভাবে মুছে ফেলা হয়েছে");
  revalidatePath("/auto-rice-mill/bag-inventory");
  return { ok: true };
}

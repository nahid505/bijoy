"use server";

import { revalidatePath } from "next/cache";
import { getContext, assertPermission } from "../auth";
import { guard, toResult, type ActionState, UserError } from "../action-utils";
import {
  saveCompanyVehicle,
  deleteCompanyVehicle,
  payDriverFare,
  type SaveCompanyVehicleInput,
} from "../services/logistics";
import { assertPaymentAccountsAllowed } from "../party-scope";

export async function saveCompanyVehicleAction(
  id: string | null,
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  return toResult(
    await guard(async () => {
      const ctx = await getContext();
      if (!ctx) throw new UserError("লগইন প্রয়োজন");

      const vehicleNo = String(fd.get("vehicleNo") || "").trim();
      const model = String(fd.get("model") || "").trim() || null;
      const driverName = String(fd.get("driverName") || "").trim() || null;
      const driverMobile = String(fd.get("driverMobile") || "").trim() || null;
      const isActive = fd.get("isActive") !== "false";

      const vehicle = await saveCompanyVehicle(
        ctx.business.id,
        { vehicleNo, model, driverName, driverMobile, isActive },
        id ?? undefined,
      );

      revalidatePath("/logistics/drivers");
      revalidatePath("/vouchers/sales/new");
      revalidatePath("/vouchers/purchase/new");
      return { success: true, vehicle };
    }),
  );
}

export async function deleteCompanyVehicleAction(id: string): Promise<ActionState> {
  return toResult(
    await guard(async () => {
      const ctx = await getContext();
      if (!ctx) throw new UserError("লগইন প্রয়োজন");

      await deleteCompanyVehicle(ctx.business.id, id);
      revalidatePath("/logistics/drivers");
      return { success: true };
    }),
  );
}

export async function payDriverFareAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  return toResult(
    await guard(async () => {
      const ctx = await getContext();
      if (!ctx) throw new UserError("লগইন প্রয়োজন");

      const driverName = String(fd.get("driverName") || "").trim();
      const driverMobile = String(fd.get("driverMobile") || "").trim() || null;
      const amount = Number(fd.get("amount") || 0);
      const cashAccountId = String(fd.get("cashAccountId") || "").trim();
      const dateStr = String(fd.get("date") || "").trim();
      const date = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date();
      const reference = String(fd.get("reference") || "").trim() || null;
      const notes = String(fd.get("notes") || "").trim() || null;

      if (!driverName) throw new UserError("ড্রাইভারের নাম দিন");
      if (!amount || amount <= 0) throw new UserError("সঠিক ভাড়ার পরিমাণ দিন");
      if (!cashAccountId) throw new UserError("নগদ/ব্যাংক হিসাব নির্বাচন করুন");

      // Verify payment account is allowed under user's partyScope
      await assertPaymentAccountsAllowed(ctx, [cashAccountId]);

      const result = await payDriverFare(ctx.business.id, ctx.user.id, {
        driverName,
        driverMobile,
        amount,
        cashAccountId,
        date,
        reference,
        notes,
      });

      revalidatePath("/logistics/drivers");
      revalidatePath("/vouchers");
      return { success: true, voucherId: result.voucher.id };
    }),
  );
}

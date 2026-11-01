"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertPermission } from "../auth";
import { audit } from "../audit";
import { guard, UserError, type ActionState } from "../action-utils";
import type { VerificationStatus } from "@prisma/client";
import { lockProducts } from "../services/inventory";
import { revalueProducts } from "../services/posting";

export type VerifyActionResult = {
  ok: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  status?: VerificationStatus;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  note?: string | null;
};

export async function verifyVoucherAction(input: {
  voucherId: string;
  status: VerificationStatus;
  note?: string | null;
}): Promise<VerifyActionResult> {
  const result = await guard(async () => {
    const ctx = await assertPermission("vouchers:verify");
    const { voucherId, status, note } = input;
    const v = await prisma.voucher.findFirst({
      where: { id: voucherId, businessId: ctx.business.id },
      select: { id: true, voucherNo: true, verificationStatus: true },
    });
    if (!v) throw new UserError("ভাউচার পাওয়া যায়নি");

    const touchesStock = v.verificationStatus === "REJECTED" || status === "REJECTED";

    const now = new Date();
    const updated = await prisma.voucher.update({
      where: { id: voucherId },
      data: {
        verificationStatus: status,
        verifiedById: status === "UNVERIFIED" ? null : ctx.user.id,
        verifiedAt: status === "UNVERIFIED" ? null : now,
        verificationNote: status === "UNVERIFIED" ? null : (note?.trim() || null),
      },
      include: {
        verifiedBy: { select: { name: true } },
      },
    });

    if (touchesStock) {
      const [items, moves] = await Promise.all([
        prisma.voucherItem.findMany({ where: { voucherId }, select: { productId: true } }),
        prisma.stockMovement.findMany({ where: { voucherId }, select: { productId: true } }),
      ]);
      const productIds = [...new Set([...items.map((i) => i.productId), ...moves.map((m) => m.productId)])];
      if (productIds.length > 0) {
        await prisma.$transaction(async (tx) => {
          await lockProducts(tx, productIds);
          await revalueProducts(tx, ctx.business.id, productIds);
        });
      }
    }

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: "Voucher",
      entityId: voucherId,
      details: {
        action: status === "VERIFIED" ? "VERIFY" : status === "REJECTED" ? "REJECT" : "UNVERIFY",
        voucherNo: v.voucherNo,
        previousStatus: v.verificationStatus,
        newStatus: status,
        note: note?.trim() || null,
      },
    });

    return {
      status: updated.verificationStatus,
      verifiedBy: updated.verifiedBy?.name ?? null,
      verifiedAt: updated.verifiedAt?.toISOString() ?? null,
      note: updated.verificationNote ?? null,
    };
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: input.status === "VERIFIED"
      ? "লেনদেন সফলভাবে অনুমোদিত (Verified) হয়েছে"
      : input.status === "REJECTED"
      ? "লেনদেন বাতিল (Rejected) করা হয়েছে"
      : "লেনদেন ভেরিফিকেশন প্রত্যাহার করা হয়েছে",
    ...result.data,
  };
}

export async function bulkVerifyVouchersAction(input: {
  voucherIds: string[];
  status: VerificationStatus;
  note?: string | null;
}): Promise<ActionState & { count?: number }> {
  const result = await guard(async () => {
    const ctx = await assertPermission("vouchers:verify");
    const { voucherIds, status, note } = input;
    if (!voucherIds || voucherIds.length === 0) {
      throw new UserError("কোনো লেনদেন নির্বাচন করা হয়নি");
    }

    const vouchers = await prisma.voucher.findMany({
      where: { id: { in: voucherIds }, businessId: ctx.business.id },
      select: { id: true, voucherNo: true, verificationStatus: true },
    });
    if (vouchers.length === 0) throw new UserError("নির্বাচিত ভাউচার পাওয়া যায়নি");

    const vIds = vouchers.map((v) => v.id);
    const touchesStock = status === "REJECTED" || vouchers.some((v) => v.verificationStatus === "REJECTED");

    const now = new Date();
    await prisma.voucher.updateMany({
      where: { id: { in: vIds }, businessId: ctx.business.id },
      data: {
        verificationStatus: status,
        verifiedById: status === "UNVERIFIED" ? null : ctx.user.id,
        verifiedAt: status === "UNVERIFIED" ? null : now,
        verificationNote: status === "UNVERIFIED" ? null : (note?.trim() || null),
      },
    });

    if (touchesStock) {
      const [items, moves] = await Promise.all([
        prisma.voucherItem.findMany({ where: { voucherId: { in: vIds } }, select: { productId: true } }),
        prisma.stockMovement.findMany({ where: { voucherId: { in: vIds } }, select: { productId: true } }),
      ]);
      const productIds = [...new Set([...items.map((i) => i.productId), ...moves.map((m) => m.productId)])];
      if (productIds.length > 0) {
        await prisma.$transaction(async (tx) => {
          await lockProducts(tx, productIds);
          await revalueProducts(tx, ctx.business.id, productIds);
        });
      }
    }

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: "Voucher",
      entityId: ctx.business.id,
      details: {
        action: status === "VERIFIED" ? "BULK_VERIFY" : status === "REJECTED" ? "BULK_REJECT" : "BULK_UNVERIFY",
        status,
        count: vouchers.length,
        voucherNos: vouchers.map((v) => v.voucherNo),
        note: note?.trim() || null,
      },
    });

    return { count: vouchers.length };
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/", "layout");
  return {
    ok: true,
    message: input.status === "VERIFIED"
      ? `${result.data.count} টি লেনদেন সফলভাবে অনুমোদিত (Verified) হয়েছে`
      : input.status === "REJECTED"
      ? `${result.data.count} টি লেনদেন বাতিল (Rejected) করা হয়েছে`
      : `${result.data.count} টি লেনদেনের ভেরিফিকেশন প্রত্যাহার করা হয়েছে`,
    count: result.data.count,
  };
}

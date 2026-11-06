"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { assertPermission } from "../auth";
import { hasPermission } from "@/lib/permissions";
import { audit } from "../audit";
import { guard, UserError, type ActionState } from "../action-utils";
import { dayRange } from "@/lib/format";
import type { Prisma, VerificationStatus } from "@prisma/client";
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
  if (input.voucherId.startsWith("att:")) {
    return verifyAttendanceAction({
      id: input.voucherId,
      status: input.status,
      note: input.note,
    });
  }

  const result = await guard(async () => {
    const { voucherId, status, note } = input;
    const required =
      status === "VERIFIED"
        ? ["can_verify_transactions", "depot_delivery_verify", "vouchers:verify", "expense:approve"]
        : status === "REJECTED"
        ? ["can_reject_transactions", "vouchers:verify"]
        : ["can_unverify_transactions", "vouchers:verify"];
    const ctx = await assertPermission(required as any);

    const v = await prisma.voucher.findFirst({
      where: { id: voucherId, businessId: ctx.business.id },
      select: {
        id: true,
        voucherNo: true,
        type: true,
        sourceKey: true,
        verificationStatus: true,
        depotDelivery: { select: { id: true } },
        entries: { select: { account: { select: { nature: true } } } },
      },
    });
    if (!v) throw new UserError("ভাউচার পাওয়া যায়নি");

    const isDepot = v.type === "DEPOT_DELIVERY" || Boolean(v.depotDelivery);
    const isExpense = v.type === "PAYMENT" || v.sourceKey?.startsWith("depot-expense:") || v.entries?.some((e) => e.account.nature === "EXPENSE");
    if (status === "VERIFIED") {
      if (!isDepot && !isExpense && !hasPermission(ctx.permissions, ["can_verify_transactions", "vouchers:verify"])) {
        throw new UserError("শুধু ডিপো ডেলিভারি চালান অনুমোদনের অনুমতি রয়েছে");
      }
      if (isExpense && !hasPermission(ctx.permissions, ["expense:approve", "can_verify_transactions", "vouchers:verify"])) {
        throw new UserError("এই খরচ এন্ট্রি বা দেখার আপনার অনুমতি নেই");
      }
    }

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
  const attIds = (input.voucherIds || []).filter((id) => id.startsWith("att:"));
  const vIds = (input.voucherIds || []).filter((id) => !id.startsWith("att:"));

  if (attIds.length > 0 && vIds.length === 0) {
    return bulkVerifyAttendanceAction({
      ids: attIds,
      status: input.status,
      note: input.note,
    });
  }

  if (attIds.length > 0 && vIds.length > 0) {
    const [vRes, attRes] = await Promise.all([
      bulkVerifyVouchersAction({ voucherIds: vIds, status: input.status, note: input.note }),
      bulkVerifyAttendanceAction({ ids: attIds, status: input.status, note: input.note }),
    ]);
    if (!vRes.ok && !attRes.ok) {
      return { ok: false, message: vRes.message || attRes.message };
    }
    const count = (vRes.count ?? 0) + (attRes.count ?? 0);
    return {
      ok: true,
      message: `${count} টি আইটেম সফলভাবে ${input.status === "VERIFIED" ? "অনুমোদিত" : "বাতিল"} হয়েছে`,
      count,
    };
  }

  const result = await guard(async () => {
    const { voucherIds, status, note } = input;
    const required =
      status === "VERIFIED"
        ? ["can_verify_transactions", "vouchers:verify"]
        : status === "REJECTED"
        ? ["can_reject_transactions", "vouchers:verify"]
        : ["can_unverify_transactions", "vouchers:verify"];
    const ctx = await assertPermission(required as any);
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

export async function verifyAttendanceAction(input: {
  id: string;
  status: VerificationStatus;
  note?: string | null;
}): Promise<VerifyActionResult> {
  const result = await guard(async () => {
    const { id, status, note } = input;
    const required =
      status === "VERIFIED"
        ? ["can_verify_transactions", "vouchers:verify", "payroll:attendance", "payroll:process"]
        : status === "REJECTED"
        ? ["can_reject_transactions", "vouchers:verify", "payroll:attendance", "payroll:process"]
        : ["can_unverify_transactions", "vouchers:verify", "payroll:attendance", "payroll:process"];
    const ctx = await assertPermission(required as any);

    let whereClause: Prisma.AttendanceWhereInput = { businessId: ctx.business.id };
    if (id.startsWith("att:")) {
      const datePart = id.slice(4).trim();
      const range = dayRange(datePart, datePart);
      whereClause = {
        businessId: ctx.business.id,
        date: range,
      };
    } else {
      whereClause = {
        businessId: ctx.business.id,
        id,
      };
    }

    const now = new Date();
    const updateResult = await prisma.attendance.updateMany({
      where: whereClause,
      data: {
        verificationStatus: status,
        verifiedById: status === "UNVERIFIED" ? null : ctx.user.id,
        verifiedAt: status === "UNVERIFIED" ? null : now,
        verificationNote: status === "UNVERIFIED" ? null : (note?.trim() || null),
      },
    });

    if (updateResult.count === 0) {
      throw new UserError("কোনো হাজিরার রেকর্ড পাওয়া যায়নি");
    }

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: "Attendance",
      entityId: id,
      details: {
        action: status === "VERIFIED" ? "VERIFY" : status === "REJECTED" ? "REJECT" : "UNVERIFY",
        id,
        count: updateResult.count,
        newStatus: status,
        note: note?.trim() || null,
      },
    });

    return {
      status,
      verifiedBy: ctx.user.name,
      verifiedAt: now.toISOString(),
      note: note?.trim() || null,
    };
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/", "layout");
  revalidatePath("/audit/unverified");
  revalidatePath("/payroll/attendance");
  return {
    ok: true,
    message:
      input.status === "VERIFIED"
        ? "হাজিরা সফলভাবে অনুমোদিত (Verified) হয়েছে"
        : input.status === "REJECTED"
        ? "হাজিরা বাতিল (Rejected) করা হয়েছে"
        : "হাজিরা ভেরিফিকেশন প্রত্যাহার করা হয়েছে",
    ...result.data,
  };
}

export async function bulkVerifyAttendanceAction(input: {
  ids: string[];
  status: VerificationStatus;
  note?: string | null;
}): Promise<ActionState & { count?: number }> {
  const result = await guard(async () => {
    const { ids, status, note } = input;
    const required =
      status === "VERIFIED"
        ? ["can_verify_transactions", "vouchers:verify", "payroll:attendance", "payroll:process"]
        : status === "REJECTED"
        ? ["can_reject_transactions", "vouchers:verify", "payroll:attendance", "payroll:process"]
        : ["can_unverify_transactions", "vouchers:verify", "payroll:attendance", "payroll:process"];
    const ctx = await assertPermission(required as any);
    if (!ids || ids.length === 0) {
      throw new UserError("কোনো হাজিরার রেকর্ড নির্বাচন করা হয়নি");
    }

    const orConditions: Prisma.AttendanceWhereInput[] = [];
    const directIds: string[] = [];

    for (const id of ids) {
      if (id.startsWith("att:")) {
        const datePart = id.slice(4).trim();
        const range = dayRange(datePart, datePart);
        orConditions.push({ date: range });
      } else {
        directIds.push(id);
      }
    }
    if (directIds.length > 0) {
      orConditions.push({ id: { in: directIds } });
    }

    if (orConditions.length === 0) {
      throw new UserError("কোনো বৈধ হাজিরার রেকর্ড নির্বাচন করা হয়নি");
    }

    const now = new Date();
    const updateResult = await prisma.attendance.updateMany({
      where: {
        businessId: ctx.business.id,
        OR: orConditions,
      },
      data: {
        verificationStatus: status,
        verifiedById: status === "UNVERIFIED" ? null : ctx.user.id,
        verifiedAt: status === "UNVERIFIED" ? null : now,
        verificationNote: status === "UNVERIFIED" ? null : (note?.trim() || null),
      },
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: "Attendance",
      entityId: ctx.business.id,
      details: {
        action: status === "VERIFIED" ? "BULK_VERIFY" : status === "REJECTED" ? "BULK_REJECT" : "BULK_UNVERIFY",
        status,
        count: updateResult.count,
        ids,
        note: note?.trim() || null,
      },
    });

    return { count: updateResult.count };
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  revalidatePath("/", "layout");
  revalidatePath("/audit/unverified");
  revalidatePath("/payroll/attendance");
  return {
    ok: true,
    message:
      input.status === "VERIFIED"
        ? `${result.data.count} টি হাজিরার রেকর্ড সফলভাবে অনুমোদিত (Verified) হয়েছে`
        : input.status === "REJECTED"
        ? `${result.data.count} টি হাজিরার রেকর্ড বাতিল (Rejected) করা হয়েছে`
        : `${result.data.count} টি হাজিরার রেকর্ডের ভেরিফিকেশন প্রত্যাহার করা হয়েছে`,
    count: result.data.count,
  };
}


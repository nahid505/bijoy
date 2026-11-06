"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertPermission, requirePermission } from "../auth";
import { formToObject, guard, parseForm, UserError, type ActionState } from "../action-utils";
import {
  acceptIntercompanyPurchase,
  disputeIntercompanyPurchase,
  getBilateralContraLedger,
  getIntercompanyReconciliationData,
  transferIntercompanyFunds,
  listBusinessBankAccounts,
} from "../services/intercompany";
import type { BilateralStatus } from "@prisma/client";

const acceptProposalSchema = z.object({
  voucherId: z.string().min(1, "ভাউচার আইডি দিন"),
  warehouseId: z.string().optional(),
});

const disputeProposalSchema = z.object({
  voucherId: z.string().min(1, "ভাউচার আইডি দিন"),
  reason: z.string().trim().min(3, "সংশোধন অনুরোধের কারণ সংক্ষেপে লিখুন (কমপক্ষে ৩ অক্ষর)"),
});

/**
 * Server Action for Buyer entity to accept a pending inter-company purchase proposal.
 * Moves stock in and posts accounts payable journal entries.
 */
export async function acceptIntercompanyPurchaseAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission(["purchases:create", "vouchers:verify", "can_verify_transactions"]);
    const input = parseForm(acceptProposalSchema, fd);

    return prisma.$transaction(
      async (tx) => {
        return acceptIntercompanyPurchase(tx, ctx.svc, input.voucherId, {
          warehouseId: input.warehouseId,
        });
      },
      { timeout: 60_000 }
    );
  });

  if (!result.ok) return { ok: false, message: result.message, errors: result.errors };

  revalidatePath("/intercompany/reconciliation");
  revalidatePath("/vouchers/purchase");
  revalidatePath("/audit/unverified");
  revalidatePath("/dashboard");

  return { ok: true, message: "আন্তঃপ্রতিষ্ঠান ক্রয় সফলভাবে অনুমোদিত হয়েছে এবং স্টক গ্রহণ সম্পন্ন হয়েছে" };
}

/**
 * Server Action for Buyer entity to request correction / dispute an inter-company proposal.
 */
export async function disputeIntercompanyPurchaseAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission(["purchases:create", "vouchers:verify", "can_reject_transactions"]);
    const input = parseForm(disputeProposalSchema, fd);

    return prisma.$transaction(
      async (tx) => {
        return disputeIntercompanyPurchase(tx, ctx.svc, input.voucherId, input.reason);
      },
      { timeout: 30_000 }
    );
  });

  if (!result.ok) return { ok: false, message: result.message, errors: result.errors };

  revalidatePath("/intercompany/reconciliation");
  revalidatePath("/vouchers/purchase");
  revalidatePath("/audit/unverified");

  return { ok: true, message: "সংশোধন অনুরোধ সংশ্লিষ্ট বিক্রেতা প্রতিষ্ঠানে প্রেরণ করা হয়েছে" };
}

/**
 * Server Action to load Bilateral Contra Ledger dynamically.
 */
export async function loadContraLedgerAction(
  entityAId: string,
  entityBId: string
) {
  const result = await guard(async () => {
    await requirePermission(["accounts:view", "reports:view", "vouchers:view"]);
    return getBilateralContraLedger(entityAId, entityBId);
  });

  if (!result.ok) throw new UserError(result.message);
  return result.data;
}

const fundTransferSchema = z.object({
  receiverBusinessId: z.string().min(1, "প্রাপক প্রতিষ্ঠান নির্বাচন করুন"),
  amount: z.coerce.number().positive("টাকার পরিমাণ ০ থেকে বেশি হতে হবে"),
  senderAccountId: z.string().min(1, "প্রেরক প্রতিষ্ঠানের নগদ বা ব্যাংক হিসাব নির্বাচন করুন"),
  receiverAccountId: z.string().min(1, "প্রাপক প্রতিষ্ঠানের নগদ বা ব্যাংক হিসাব নির্বাচন করুন"),
  transferType: z.enum(["LOAN", "ADVANCE", "WORKING_CAPITAL", "SETTLEMENT"]).default("LOAN"),
  reference: z.string().optional(),
  narration: z.string().optional(),
});

/**
 * 1-Click Intercompany Fund Transfer Server Action
 */
export async function transferIntercompanyFundsAction(
  _prev: ActionState,
  fd: FormData
): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await assertPermission(["vouchers:create", "vouchers:verify", "accounts:manage"]);
    const input = parseForm(fundTransferSchema, fd);

    return transferIntercompanyFunds({
      senderBusinessId: ctx.business.id,
      receiverBusinessId: input.receiverBusinessId,
      amount: input.amount,
      senderAccountId: input.senderAccountId,
      receiverAccountId: input.receiverAccountId,
      transferType: input.transferType,
      reference: input.reference || null,
      narration: input.narration || null,
      userId: ctx.user.id,
    });
  });

  if (!result.ok) return { ok: false, message: result.message, errors: result.errors };

  revalidatePath("/intercompany/reconciliation");
  revalidatePath("/intercompany/fund-transfer");
  revalidatePath("/vouchers/payment");
  revalidatePath("/vouchers/receipt");
  revalidatePath("/dashboard");

  return {
    ok: true,
    message: `তহবিল স্থানান্তর সফল হয়েছে! প্রেরক ভাউচার: ${result.data.senderVoucherNo}, প্রাপক ভাউচার: ${result.data.receiverVoucherNo}`,
    data: {
      senderVoucherId: result.data.senderVoucherId,
      receiverVoucherId: result.data.receiverVoucherId,
      senderVoucherNo: result.data.senderVoucherNo,
      receiverVoucherNo: result.data.receiverVoucherNo,
    },
  };
}

/**
 * Load Bank / Cash accounts for any sister entity
 */
export async function loadEntityBankAccountsAction(businessId: string) {
  const result = await guard(async () => {
    await requirePermission(["accounts:view", "vouchers:create", "vouchers:view"]);
    return listBusinessBankAccounts(businessId);
  });

  if (!result.ok) throw new UserError(result.message);
  return result.data;
}


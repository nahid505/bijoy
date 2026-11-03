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

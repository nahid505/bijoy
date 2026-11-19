"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { guard, toResult, UserError, type ActionState } from "@/server/action-utils";
import { requireContext } from "@/server/auth";
import { audit } from "@/server/audit";
import {
  calculateMillingBill,
  calculateStandardBags,
  getOrCreateOwnerParty,
  getRiceMillSettings,
  isTodayDate,
  resolveMillRole,
} from "@/lib/custom-milling";

const batchSchema = z.object({
  partyId: z.string().min(1, "পার্টি নির্বাচন করুন"),
  paddyType: z.string().trim().min(1, "ধানের জাত লিখুন"),
  vehicleNo: z.string().trim().optional(),
  date: z.string().min(1, "তারিখ দিন"),
  physicalBags: z.coerce.number().int().min(1, "বস্তার সংখ্যা কমপক্ষে ১ হতে হবে"),
  grossWeightKg: z.coerce.number().min(0, "গ্রস ওজন সঠিক দিন"),
  tareWeightKg: z.coerce.number().min(0, "গাড়ির খালি ওজন সঠিক দিন"),
  dhaltaPerBagKg: z.coerce.number().min(0).default(1.5),
});

/**
 * Creates a new Weighbridge Intake Batch.
 * RBAC Rule: MILL_ACCOUNTANT can ONLY create for today's date.
 */
export async function createBatchAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role === "MILL_PARTNER") {
      throw new UserError("পার্টনার অ্যাকাউন্টে শুধুমাত্র দেখার অনুমতি আছে — নতুন এন্ট্রি করা যাবে না।");
    }

    const input = batchSchema.parse({
      partyId: String(fd.get("partyId") ?? ""),
      paddyType: String(fd.get("paddyType") ?? ""),
      vehicleNo: String(fd.get("vehicleNo") ?? ""),
      date: String(fd.get("date") ?? new Date().toISOString().slice(0, 10)),
      physicalBags: fd.get("physicalBags"),
      grossWeightKg: fd.get("grossWeightKg"),
      tareWeightKg: fd.get("tareWeightKg"),
      dhaltaPerBagKg: fd.get("dhaltaPerBagKg") || 1.5,
    });

    const parsedDate = new Date(input.date);
    // RBAC: Mill accountant cannot backdate!
    if (role === "MILL_ACCOUNTANT" && !isTodayDate(parsedDate)) {
      throw new UserError("হিসাবরক্ষক শুধুমাত্র আজকের তারিখের নতুন এন্ট্রি করতে পারবেন। পেছনের তারিখে এন্ট্রি অনুমোদিত নয়।");
    }

    const settings = await getRiceMillSettings();
    const { dhaltaKg, netWeightKg, standardBags75Kg } = calculateStandardBags({
      grossWeightKg: input.grossWeightKg,
      tareWeightKg: input.tareWeightKg,
      physicalBags: input.physicalBags,
      dhaltaPerBagKg: input.dhaltaPerBagKg,
      bagStandardKg: settings.bagStandardKg || 75.0,
    });

    const party = await prisma.millParty.findUniqueOrThrow({ where: { id: input.partyId } });

    // Generate batch number BATCH-YYYYMMDD-XXXX
    const datePrefix = input.date.replace(/-/g, "");
    const countToday = await prisma.millBatch.count({
      where: {
        batchNo: { startsWith: `BATCH-${datePrefix}-` },
      },
    });
    const batchNo = `BATCH-${datePrefix}-${String(countToday + 1).padStart(3, "0")}`;

    const batch = await prisma.millBatch.create({
      data: {
        batchNo,
        date: parsedDate,
        partyId: input.partyId,
        paddyType: input.paddyType,
        vehicleNo: input.vehicleNo || null,
        physicalBags: input.physicalBags,
        grossWeightKg: input.grossWeightKg,
        tareWeightKg: input.tareWeightKg,
        dhaltaKg,
        netWeightKg,
        standardBags75Kg,
        status: "RECEIVED",
        dryerRatePerBag: settings.defaultDryerRate || 50,
        millingRatePerBag: settings.defaultMillingRate || 120,
        mainSyncStatus: party.isOwnerSelfParty ? "PENDING" : "NOT_APPLICABLE",
        createdByName: ctx.user.name,
        createdByUserId: ctx.user.id,
      },
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "MillBatch",
      entityId: batch.id,
      details: { batchNo, standardBags75Kg, party: party.name },
    });

    return batch;
  });

  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: `ব্যাচ #${result.data.batchNo} সফলভাবে তৈরি হয়েছে (${result.data.standardBags75Kg} স্ট্যান্ডার্ড বস্তা)` } : toResult(result);
}

/**
 * Updates batch workflow status (RECEIVED -> IN_DRYER -> MILLED -> DELIVERED).
 */
export async function updateBatchStatusAction(batchId: string, status: string): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role === "MILL_PARTNER") {
      throw new UserError("পার্টনার অ্যাকাউন্টে শুধুমাত্র দেখার অনুমতি আছে।");
    }

    const batch = await prisma.millBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (role === "MILL_ACCOUNTANT" && !isTodayDate(batch.date)) {
      throw new UserError("হিসাবরক্ষক পূর্ববর্তী দিনের ব্যাচের স্ট্যাটাস পরিবর্তন করতে পারবেন না।");
    }

    const updated = await prisma.millBatch.update({
      where: { id: batchId },
      data: { status },
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: "MillBatch",
      entityId: batch.id,
      details: { status },
    });

    return updated;
  });

  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: `ব্যাচ #${result.data.batchNo} স্ট্যাটাস আপডেট হয়েছে: ${status}` } : toResult(result);
}

const billingSchema = z.object({
  dryerRatePerBag: z.coerce.number().min(0),
  millingRatePerBag: z.coerce.number().min(0),
  riceOutputBags: z.coerce.number().min(0).default(0),
  branKg: z.coerce.number().min(0).default(0),
  branRatePerKg: z.coerce.number().min(0).default(22),
  huskKg: z.coerce.number().min(0).default(0),
  huskRatePerKg: z.coerce.number().min(0).default(8),
  byProductKeptMill: z.boolean(),
  markDelivered: z.boolean().default(false),
});

/**
 * Saves dryer, milling, and by-product billing for a batch.
 */
export async function saveBatchBillingAction(batchId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role === "MILL_PARTNER") {
      throw new UserError("পার্টনার অ্যাকাউন্টে শুধুমাত্র দেখার অনুমতি আছে।");
    }

    const batch = await prisma.millBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { party: true },
    });

    if (role === "MILL_ACCOUNTANT" && !isTodayDate(batch.date)) {
      throw new UserError("হিসাবরক্ষক পেছনের দিনের ব্যাচের বিল এডিট করতে পারবেন না।");
    }

    const input = billingSchema.parse({
      dryerRatePerBag: fd.get("dryerRatePerBag") || 0,
      millingRatePerBag: fd.get("millingRatePerBag") || 0,
      riceOutputBags: fd.get("riceOutputBags") || 0,
      branKg: fd.get("branKg") || 0,
      branRatePerKg: fd.get("branRatePerKg") || 22,
      huskKg: fd.get("huskKg") || 0,
      huskRatePerKg: fd.get("huskRatePerKg") || 8,
      byProductKeptMill: fd.get("byProductKeptMill") === "on",
      markDelivered: fd.get("markDelivered") === "on",
    });

    const { dryerFee, millingFee, byProductIncome, totalBillAmount } = calculateMillingBill({
      standardBags75Kg: batch.standardBags75Kg,
      dryerRatePerBag: input.dryerRatePerBag,
      millingRatePerBag: input.millingRatePerBag,
      branKg: input.branKg,
      branRatePerKg: input.branRatePerKg,
      huskKg: input.huskKg,
      huskRatePerKg: input.huskRatePerKg,
      byProductKeptMill: input.byProductKeptMill,
    });

    // Difference in bill amount to adjust party due
    const billDiff = totalBillAmount - Number(batch.totalBillAmount || 0);

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.millBatch.update({
        where: { id: batchId },
        data: {
          dryerRatePerBag: input.dryerRatePerBag,
          dryerFee,
          millingRatePerBag: input.millingRatePerBag,
          millingFee,
          riceOutputBags: input.riceOutputBags,
          branKg: input.branKg,
          huskKg: input.huskKg,
          byProductKeptMill: input.byProductKeptMill,
          byProductIncome,
          totalBillAmount,
          status: input.markDelivered ? "DELIVERED" : batch.status === "RECEIVED" ? "MILLED" : batch.status,
          mainSyncStatus: batch.party.isOwnerSelfParty ? "PENDING" : batch.mainSyncStatus,
        },
      });

      if (billDiff !== 0) {
        await tx.millParty.update({
          where: { id: batch.partyId },
          data: {
            currentDue: { increment: billDiff },
          },
        });
      }

      return b;
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: "MillBatch",
      entityId: batch.id,
      details: { totalBillAmount, dryerFee, millingFee, byProductIncome },
    });

    return updated;
  });

  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: `ব্যাচ #${result.data.batchNo} বিল সফলভাবে সংরক্ষণ হয়েছে (মোট বিল: ৳${result.data.totalBillAmount})` } : toResult(result);
}

/**
 * Deletes a batch record (Super Admin ONLY).
 */
export async function deleteBatchAction(batchId: string): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role !== "SUPER_ADMIN") {
      throw new UserError("শুধুমাত্র সুপার অ্যাডমিন (নাহিদ হাসান) রেকর্ড ডিলিট করতে পারবেন।");
    }

    const batch = await prisma.millBatch.findUniqueOrThrow({ where: { id: batchId } });

    await prisma.$transaction(async (tx) => {
      if (batch.totalBillAmount > 0) {
        await tx.millParty.update({
          where: { id: batch.partyId },
          data: { currentDue: { decrement: batch.totalBillAmount } },
        });
      }
      await tx.millBatch.delete({ where: { id: batchId } });
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "DELETE",
      entity: "MillBatch",
      entityId: batchId,
      details: { batchNo: batch.batchNo },
    });
  });

  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: "ব্যাচ রেকর্ড মুছে ফেলা হয়েছে" } : toResult(result);
}

const expenseSchema = z.object({
  category: z.enum(["MILL_RENT", "ELECTRICITY_FUEL", "LABOUR", "PARTS_MAINTENANCE", "OTHER"]),
  description: z.string().trim().min(1, "বিবরণ লিখুন"),
  amount: z.coerce.number().min(1, "সঠিক টাকা লিখুন"),
  paidBy: z.enum(["MILL_CASH", "PARTNER_1", "PARTNER_2"]).default("MILL_CASH"),
  date: z.string().min(1, "তারিখ দিন"),
});

/**
 * Records a mill expense.
 * If paidBy === PARTNER_1, automatically flags mainSyncStatus = PENDING.
 */
export async function createExpenseAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role === "MILL_PARTNER") {
      throw new UserError("পার্টনার অ্যাকাউন্টে শুধুমাত্র দেখার অনুমতি আছে।");
    }

    const input = expenseSchema.parse({
      category: fd.get("category"),
      description: fd.get("description"),
      amount: fd.get("amount"),
      paidBy: fd.get("paidBy") || "MILL_CASH",
      date: String(fd.get("date") ?? new Date().toISOString().slice(0, 10)),
    });

    const parsedDate = new Date(input.date);
    if (role === "MILL_ACCOUNTANT" && !isTodayDate(parsedDate)) {
      throw new UserError("হিসাবরক্ষক শুধুমাত্র আজকের তারিখের খরচ এন্ট্রি করতে পারবেন।");
    }

    const isPartner1Out = input.paidBy === "PARTNER_1";

    const expense = await prisma.millExpense.create({
      data: {
        category: input.category,
        description: input.description,
        amount: input.amount,
        paidBy: input.paidBy,
        date: parsedDate,
        mainSyncStatus: isPartner1Out ? "PENDING" : "NOT_APPLICABLE",
        createdByName: ctx.user.name,
        createdByUserId: ctx.user.id,
      },
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "MillExpense",
      entityId: expense.id,
      details: { category: input.category, amount: input.amount, paidBy: input.paidBy },
    });

    return expense;
  });

  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: `খরচ এন্ট্রি সফল হয়েছে (৳${result.data.amount})` } : toResult(result);
}

/**
 * Deletes an expense (Super Admin ONLY).
 */
export async function deleteExpenseAction(expenseId: string): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role !== "SUPER_ADMIN") {
      throw new UserError("শুধুমাত্র সুপার অ্যাডমিন (নাহিদ হাসান) খরচ মুছে ফেলতে পারবেন।");
    }

    const exp = await prisma.millExpense.delete({ where: { id: expenseId } });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "DELETE",
      entity: "MillExpense",
      entityId: expenseId,
      details: { amount: exp.amount, category: exp.category },
    });
  });

  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: "খরচ মুছে ফেলা হয়েছে" } : toResult(result);
}

const voucherSchema = z.object({
  type: z.enum(["RECEIPT", "PAYMENT"]),
  partyId: z.string().optional(),
  partnerTarget: z.enum(["PARTNER_1", "PARTNER_2"]).optional(),
  paymentMode: z.string().default("CASH"),
  amount: z.coerce.number().min(1, "টাকার পরিমাণ লিখুন"),
  note: z.string().trim().optional(),
  date: z.string().min(1, "তারিখ দিন"),
});

/**
 * Records Cashbook receipts from parties or withdrawals by partners.
 */
export async function createVoucherAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role === "MILL_PARTNER") {
      throw new UserError("পার্টনার অ্যাকাউন্টে শুধুমাত্র দেখার অনুমতি আছে।");
    }

    const input = voucherSchema.parse({
      type: fd.get("type"),
      partyId: String(fd.get("partyId") ?? ""),
      partnerTarget: fd.get("partnerTarget") ? String(fd.get("partnerTarget")) : undefined,
      paymentMode: String(fd.get("paymentMode") || "CASH"),
      amount: fd.get("amount"),
      note: String(fd.get("note") ?? ""),
      date: String(fd.get("date") ?? new Date().toISOString().slice(0, 10)),
    });

    const parsedDate = new Date(input.date);
    if (role === "MILL_ACCOUNTANT" && !isTodayDate(parsedDate)) {
      throw new UserError("হিসাবরক্ষক শুধুমাত্র আজকের তারিখে ভাউচার করতে পারবেন।");
    }

    if (input.type === "RECEIPT" && !input.partyId) {
      throw new UserError("টাকা গ্রহণের জন্য পার্টি নির্বাচন করুন।");
    }

    if (input.type === "PAYMENT" && !input.partnerTarget && !input.partyId) {
      throw new UserError("উত্তোলনের জন্য পার্টনার নির্বাচন করুন।");
    }

    const datePrefix = input.date.replace(/-/g, "");
    const countToday = await prisma.millVoucher.count({
      where: { voucherNo: { startsWith: `MV-${datePrefix}-` } },
    });
    const voucherNo = `MV-${datePrefix}-${String(countToday + 1).padStart(3, "0")}`;

    const voucher = await prisma.$transaction(async (tx) => {
      const v = await tx.millVoucher.create({
        data: {
          voucherNo,
          date: parsedDate,
          type: input.type,
          partyId: input.partyId || null,
          partnerTarget: input.partnerTarget || null,
          paymentMode: input.paymentMode,
          amount: input.amount,
          note: input.note || null,
          createdByName: ctx.user.name,
          createdByUserId: ctx.user.id,
        },
      });

      // If receipt from party, decrease due
      if (input.type === "RECEIPT" && input.partyId) {
        await tx.millParty.update({
          where: { id: input.partyId },
          data: { currentDue: { decrement: input.amount } },
        });
      }

      return v;
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "MillVoucher",
      entityId: voucher.id,
      details: { voucherNo, type: input.type, amount: input.amount },
    });

    return voucher;
  });

  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: `ভাউচার #${result.data.voucherNo} সম্পন্ন হয়েছে (৳${result.data.amount})` } : toResult(result);
}

/**
 * Deletes a voucher (Super Admin ONLY).
 */
export async function deleteVoucherAction(voucherId: string): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role !== "SUPER_ADMIN") {
      throw new UserError("শুধুমাত্র সুপার অ্যাডমিন (নাহিদ হাসান) ভাউচার মুছে ফেলতে পারবেন।");
    }

    const v = await prisma.millVoucher.findUniqueOrThrow({ where: { id: voucherId } });

    await prisma.$transaction(async (tx) => {
      if (v.type === "RECEIPT" && v.partyId) {
        await tx.millParty.update({
          where: { id: v.partyId },
          data: { currentDue: { increment: v.amount } },
        });
      }
      await tx.millVoucher.delete({ where: { id: voucherId } });
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "DELETE",
      entity: "MillVoucher",
      entityId: voucherId,
      details: { voucherNo: v.voucherNo },
    });
  });

  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: "ভাউচার মুছে ফেলা হয়েছে" } : toResult(result);
}

const partySchema = z.object({
  name: z.string().trim().min(1, "পার্টির নাম লিখুন"),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  openingBalance: z.coerce.number().default(0),
  isOwnerSelfParty: z.boolean().default(false),
});

/**
 * Creates a new Mill Party.
 */
export async function createPartyAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role === "MILL_PARTNER") {
      throw new UserError("পার্টনার অ্যাকাউন্টে শুধুমাত্র দেখার অনুমতি আছে।");
    }

    const input = partySchema.parse({
      name: String(fd.get("name") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      address: String(fd.get("address") ?? ""),
      openingBalance: fd.get("openingBalance") || 0,
      isOwnerSelfParty: fd.get("isOwnerSelfParty") === "on",
    });

    const party = await prisma.millParty.create({
      data: {
        name: input.name,
        phone: input.phone || null,
        address: input.address || null,
        openingBalance: input.openingBalance,
        currentDue: input.openingBalance,
        isOwnerSelfParty: input.isOwnerSelfParty,
      },
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "MillParty",
      entityId: party.id,
      details: { name: party.name, isOwnerSelfParty: party.isOwnerSelfParty },
    });

    return party;
  });

  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: `পার্টি '${result.data.name}' সফলভাবে যোগ হয়েছে` } : toResult(result);
}

const settingsSchema = z.object({
  millName: z.string().trim().min(1, "মিলের নাম লিখুন"),
  millAddress: z.string().trim().min(1, "ঠিকানা লিখুন"),
  millPhone: z.string().trim().min(1, "ফোন নম্বর দিন"),
  partner1Name: z.string().trim().min(1, "পার্টনার ১ এর নাম দিন"),
  partner1SharePct: z.coerce.number().min(0).max(100),
  partner2Name: z.string().trim().min(1, "পার্টনার ২ এর নাম দিন"),
  partner2SharePct: z.coerce.number().min(0).max(100),
  monthlyRent: z.coerce.number().min(0),
  bagStandardKg: z.coerce.number().min(10),
  defaultDhaltaPerBag: z.coerce.number().min(0),
  defaultDryerRate: z.coerce.number().min(0),
  defaultMillingRate: z.coerce.number().min(0),
  branRatePerKg: z.coerce.number().min(0),
  huskRatePerKg: z.coerce.number().min(0),
  invoiceFooterNote: z.string().trim().min(1),
});

/**
 * Saves Rice Mill Settings (Super Admin ONLY).
 */
export async function saveSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role !== "SUPER_ADMIN") {
      throw new UserError("শুধুমাত্র সুপার অ্যাডমিন (নাহিদ হাসান) সেটিংস পরিবর্তন করতে পারবেন।");
    }

    const input = settingsSchema.parse({
      millName: fd.get("millName"),
      millAddress: fd.get("millAddress"),
      millPhone: fd.get("millPhone"),
      partner1Name: fd.get("partner1Name"),
      partner1SharePct: fd.get("partner1SharePct"),
      partner2Name: fd.get("partner2Name"),
      partner2SharePct: fd.get("partner2SharePct"),
      monthlyRent: fd.get("monthlyRent"),
      bagStandardKg: fd.get("bagStandardKg"),
      defaultDhaltaPerBag: fd.get("defaultDhaltaPerBag"),
      defaultDryerRate: fd.get("defaultDryerRate"),
      defaultMillingRate: fd.get("defaultMillingRate"),
      branRatePerKg: fd.get("branRatePerKg"),
      huskRatePerKg: fd.get("huskRatePerKg"),
      invoiceFooterNote: fd.get("invoiceFooterNote"),
    });

    const updated = await prisma.riceMillSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...input },
      update: input,
    });

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: "RiceMillSettings",
      entityId: "1",
      details: { millName: input.millName, bagStandardKg: input.bagStandardKg },
    });

    return updated;
  });

  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: "রাইস মিল সেটিংস সংরক্ষণ হয়েছে" } : toResult(result);
}

/**
 * Inter-Company Bridge Sync: Post an Owner Batch or Partner 1 Expense to Main Business Account.
 * Visible ONLY to SUPER_ADMIN (Nahid Hasan).
 */
export async function postToMainAccountAction(type: "BATCH" | "EXPENSE", id: string): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role !== "SUPER_ADMIN") {
      throw new UserError("শুধুমাত্র সুপার অ্যাডমিন (নাহিদ হাসান) মূল ব্যবসায় এন্ট্রি পোস্ট করতে পারবেন।");
    }

    if (type === "BATCH") {
      const batch = await prisma.millBatch.findUniqueOrThrow({
        where: { id },
        include: { party: true },
      });

      if (!batch.party.isOwnerSelfParty) {
        throw new UserError("এই ব্যাচটি নিজস্ব পার্টির নয় — মূল হিসাবে পোস্ট প্রযোজ্য নয়।");
      }

      await prisma.millBatch.update({
        where: { id },
        data: { mainSyncStatus: "POSTED" },
      });

      await audit({
        businessId: ctx.business.id,
        userId: ctx.user.id,
        action: "UPDATE",
        entity: "MillBatch",
        entityId: id,
        details: { bridgeSync: "POSTED", batchNo: batch.batchNo, bill: batch.totalBillAmount },
      });

      return `ব্যাচ #${batch.batchNo} এর বিল (৳${batch.totalBillAmount}) মূল ব্যবসায় অন্তর্ভুক্ত করা হয়েছে`;
    } else {
      const expense = await prisma.millExpense.findUniqueOrThrow({ where: { id } });

      if (expense.paidBy !== "PARTNER_1") {
        throw new UserError("এই খরচটি পার্টনার ১ এর পকেট থেকে দেওয়া নয়।");
      }

      await prisma.millExpense.update({
        where: { id },
        data: { mainSyncStatus: "POSTED" },
      });

      await audit({
        businessId: ctx.business.id,
        userId: ctx.user.id,
        action: "UPDATE",
        entity: "MillExpense",
        entityId: id,
        details: { bridgeSync: "POSTED", category: expense.category, amount: expense.amount },
      });

      return `খরচ '${expense.description}' (৳${expense.amount}) মূল ব্যবসায় অন্তর্ভুক্ত করা হয়েছে`;
    }
  });

  revalidatePath("/dashboard");
  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: result.data } : toResult(result);
}

/**
 * Rejects a Bridge Sync item.
 */
export async function rejectBridgeSyncAction(type: "BATCH" | "EXPENSE", id: string): Promise<ActionState> {
  const result = await guard(async () => {
    const ctx = await requireContext();
    const role = resolveMillRole(ctx);

    if (role !== "SUPER_ADMIN") {
      throw new UserError("শুধুমাত্র সুপার অ্যাডমিন (নাহিদ হাসান) ব্রিজ সিঙ্ক বাতিল করতে পারবেন।");
    }

    if (type === "BATCH") {
      await prisma.millBatch.update({ where: { id }, data: { mainSyncStatus: "REJECTED" } });
    } else {
      await prisma.millExpense.update({ where: { id }, data: { mainSyncStatus: "REJECTED" } });
    }

    await audit({
      businessId: ctx.business.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: type === "BATCH" ? "MillBatch" : "MillExpense",
      entityId: id,
      details: { bridgeSync: "REJECTED" },
    });
  });

  revalidatePath("/dashboard");
  revalidatePath("/custom-milling", "layout");
  return result.ok ? { ok: true, message: "ব্রিজ সিঙ্ক আইটেম বাতিল করা হয়েছে" } : toResult(result);
}

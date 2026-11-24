"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  getRentedMillSettings,
  resolveRentedMillRole,
  parseExpenseCategories,
} from "@/lib/rented-mill";
import bcrypt from "bcryptjs";

// Helper to check write access
async function checkWriteAccess() {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  if (role === "GUEST") {
    throw new Error("আপনার এই মডিউলে কাজ করার অনুমতি নেই।");
  }

  if (role === "PARTNER") {
    throw new Error("পার্টনারের শুধুমাত্র দেখার অনুমতি (Read-Only) রয়েছে। কোনো তথ্য এন্ট্রি, পরিবর্তন বা মুছার অনুমতি নেই।");
  }

  return { ctx, settings, role };
}

// Helper to check admin delete access
async function checkAdminAccess() {
  const { ctx, settings, role } = await checkWriteAccess();
  if (role !== "SUPER_ADMIN") {
    throw new Error("শুধুমাত্র সুপার অ্যাডমিন / নাহিদ হাসান সেটিংস পরিবর্তন বা প্রশাসনিক কাজ করতে পারেন।");
  }
  return { ctx, settings, role };
}

// Helper to check edit/delete access based on entry status
async function checkEditOrDeleteAccess(entryStatus?: string) {
  const { ctx, settings, role } = await checkWriteAccess();
  if (role === "SUPER_ADMIN") {
    return { ctx, settings, role };
  }
  if (role === "ACCOUNTANT") {
    if (entryStatus === "PENDING") {
      return { ctx, settings, role };
    }
    throw new Error("অনুমোদিত (APPROVED) এন্ট্রি শুধুমাত্র সুপার অ্যাডমিন / নাহিদ হাসান সম্পাদনা বা মুছতে পারবেন।");
  }
  throw new Error("আপনার এই এন্ট্রি সম্পাদনা বা মুছার অনুমতি নেই।");
}

// ───────────────────────────── 1. সেটিংস ও হিসাবরক্ষক ─────────────────────────────

export async function saveRentedMillSettingsAction(formData: FormData) {
  await checkAdminAccess();

  const millName = String(formData.get("millName") || "").trim() || "ভাড়া অটো রাইস মিল";
  const millAddress = String(formData.get("millAddress") || "").trim();
  const millPhone = String(formData.get("millPhone") || "").trim();
  const monthlyRent = parseFloat(String(formData.get("monthlyRent") || "280000")) || 280000;
  const partner1Name = String(formData.get("partner1Name") || "").trim() || "নাহিদ হাসান";
  const partner1Share = parseFloat(String(formData.get("partner1Share") || "50")) || 50;
  const partner2Name = String(formData.get("partner2Name") || "").trim() || "পার্টনার";
  const partner2Share = parseFloat(String(formData.get("partner2Share") || "50")) || 50;
  const defaultMillingRate = parseFloat(String(formData.get("defaultMillingRate") || "100")) || 100;
  const accountantUserId = String(formData.get("accountantUserId") || "").trim() || null;
  const rawDryerNames = formData.get("dryerNames");
  const dryerNames = rawDryerNames ? String(rawDryerNames).trim() : undefined;
  const rawExpenseCategories = formData.get("expenseCategories");
  const expenseCategories = rawExpenseCategories ? String(rawExpenseCategories).trim() : undefined;

  await prisma.rentedMillSettings.upsert({
    where: { id: 1 },
    update: {
      millName,
      millAddress,
      millPhone,
      monthlyRent,
      partner1Name,
      partner1Share,
      partner2Name,
      partner2Share,
      defaultMillingRate,
      ...(dryerNames ? { dryerNames } : {}),
      ...(expenseCategories ? { expenseCategories } : {}),
      accountantUserId,
    },
    create: {
      id: 1,
      millName,
      millAddress,
      millPhone,
      monthlyRent,
      partner1Name,
      partner1Share,
      partner2Name,
      partner2Share,
      defaultMillingRate,
      ...(dryerNames ? { dryerNames } : {}),
      ...(expenseCategories ? { expenseCategories } : {}),
      accountantUserId,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: "সেটিংস সফলভাবে সংরক্ষিত হয়েছে।" };
}

export async function updateDryerNamesAction(dryerNames: string[]) {
  await checkWriteAccess();
  const cleaned = dryerNames.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    throw new Error("কমপক্ষে একটি ডায়ারের নাম থাকতে হবে।");
  }
  const jsonStr = JSON.stringify(cleaned);
  await prisma.rentedMillSettings.upsert({
    where: { id: 1 },
    update: { dryerNames: jsonStr },
    create: {
      id: 1,
      millName: "শুভংকর অটো রাইস মিল",
      millAddress: "দিনাজপুর",
      millPhone: "01763921505",
      monthlyRent: 280000,
      partner1Name: "নাহিদ হাসান",
      partner1Share: 50.0,
      partner2Name: "পার্টনার",
      partner2Share: 50.0,
      defaultMillingRate: 100,
      dryerNames: jsonStr,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, dryerNames: cleaned, message: "ডায়ার তালিকা সফলভাবে আপডেট হয়েছে।" };
}

export async function updateExpenseCategoriesAction(categories: string[]) {
  await checkWriteAccess();
  const cleaned = categories.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    throw new Error("কমপক্ষে একটি খরচের খতিয়ান থাকতে হবে।");
  }
  // Ensure unique categories
  const uniqueCategories = Array.from(new Set(cleaned));
  const jsonStr = JSON.stringify(uniqueCategories);

  await prisma.rentedMillSettings.upsert({
    where: { id: 1 },
    update: { expenseCategories: jsonStr },
    create: {
      id: 1,
      millName: "শুভংকর অটো রাইস মিল",
      millAddress: "দিনাজপুর",
      millPhone: "01763921505",
      monthlyRent: 280000,
      partner1Name: "নাহিদ হাসান",
      partner1Share: 50.0,
      partner2Name: "পার্টনার",
      partner2Share: 50.0,
      defaultMillingRate: 100,
      expenseCategories: jsonStr,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, categories: uniqueCategories, message: "খরচের খতিয়ান তালিকা সফলভাবে সংরক্ষিত হয়েছে।" };
}

export async function addExpenseCategoryAction(newCategory: string) {
  await checkWriteAccess();
  const trimmed = newCategory.trim();
  if (!trimmed) {
    throw new Error("খরচের খতিয়ানের নাম খালি রাখা যাবে না।");
  }

  const settings = await getRentedMillSettings();
  const current = parseExpenseCategories(settings.expenseCategories);
  if (current.includes(trimmed)) {
    return { ok: true, category: trimmed, categories: current, message: `"${trimmed}" খতিয়ানটি পূর্বেই যুক্ত রয়েছে।` };
  }

  const updated = [...current, trimmed];
  const jsonStr = JSON.stringify(updated);

  await prisma.rentedMillSettings.upsert({
    where: { id: 1 },
    update: { expenseCategories: jsonStr },
    create: {
      id: 1,
      millName: "শুভংকর অটো রাইস মিল",
      millAddress: "দিনাজপুর",
      millPhone: "01763921505",
      monthlyRent: 280000,
      partner1Name: "নাহিদ হাসান",
      partner1Share: 50.0,
      partner2Name: "পার্টনার",
      partner2Share: 50.0,
      defaultMillingRate: 100,
      expenseCategories: jsonStr,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, category: trimmed, categories: updated, message: `নতুন খরচের খাত "${trimmed}" সফলভাবে যুক্ত হয়েছে।` };
}

export async function createAndAssignAccountantAction(formData: FormData) {
  const { ctx } = await checkAdminAccess();

  const mode = String(formData.get("mode") || "assign"); // "assign" | "create"

  if (mode === "assign") {
    const userId = String(formData.get("userId") || "").trim() || null;
    await prisma.rentedMillSettings.upsert({
      where: { id: 1 },
      update: { accountantUserId: userId },
      create: { accountantUserId: userId },
    });
    revalidatePath("/rented-mill", "layout");
    return { ok: true, message: "হিসাবরক্ষক সফলভাবে অ্যাসাইন করা হয়েছে।" };
  }

  // Create new user
  const name = String(formData.get("name") || "").trim();
  const mobile = String(formData.get("mobile") || "").trim();
  const email = String(formData.get("email") || "").trim() || null;
  const password = String(formData.get("password") || "").trim();

  if (!name || (!mobile && !email) || !password) {
    throw new Error("নাম, মোবাইল/ইমেইল এবং পাসওয়ার্ড দেওয়া বাধ্যতামূলক।");
  }

  // Check if user already exists
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        mobile ? { mobile } : {},
        email ? { email } : {},
      ],
    },
  });

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: {
        name,
        mobile: mobile || null,
        email: email || null,
        passwordHash,
        isActive: true,
      },
    });
    userId = newUser.id;

    // Attach membership to current business so login context resolves smoothly
    try {
      const defaultRole = await prisma.role.findFirst({
        where: { businessId: ctx.business.id },
      });
      if (defaultRole) {
        await prisma.membership.create({
          data: {
            userId: newUser.id,
            businessId: ctx.business.id,
            roleId: defaultRole.id,
          },
        });
      }
    } catch (err) {
      console.warn("Could not create membership for new accountant user:", err);
    }
  }

  await prisma.rentedMillSettings.upsert({
    where: { id: 1 },
    update: { accountantUserId: userId },
    create: { accountantUserId: userId },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `হিসাবরক্ষক (${name}) সফলভাবে তৈরি ও সংযুক্ত করা হয়েছে।` };
}

export async function createAndAssignPartnerAction(formData: FormData) {
  const { ctx } = await checkAdminAccess();

  const mode = String(formData.get("mode") || "assign"); // "assign" | "create"

  if (mode === "assign") {
    const userId = String(formData.get("userId") || "").trim() || null;
    await prisma.rentedMillSettings.upsert({
      where: { id: 1 },
      update: { partnerUserId: userId },
      create: { partnerUserId: userId },
    });
    revalidatePath("/rented-mill", "layout");
    return { ok: true, message: "পার্টনার সফলভাবে অ্যাসাইন করা হয়েছে।" };
  }

  // Create new user
  const name = String(formData.get("name") || "").trim();
  const mobile = String(formData.get("mobile") || "").trim();
  const email = String(formData.get("email") || "").trim() || null;
  const password = String(formData.get("password") || "").trim();

  if (!name || (!mobile && !email) || !password) {
    throw new Error("নাম, মোবাইল/ইমেইল এবং পাসওয়ার্ড দেওয়া বাধ্যতামূলক।");
  }

  // Check if user already exists
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        mobile ? { mobile } : {},
        email ? { email } : {},
      ],
    },
  });

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: {
        name,
        mobile: mobile || null,
        email: email || null,
        passwordHash,
        isActive: true,
      },
    });
    userId = newUser.id;

    // Attach membership to current business so login context resolves smoothly
    try {
      const defaultRole = await prisma.role.findFirst({
        where: { businessId: ctx.business.id },
      });
      if (defaultRole) {
        await prisma.membership.create({
          data: {
            userId: newUser.id,
            businessId: ctx.business.id,
            roleId: defaultRole.id,
          },
        });
      }
    } catch (err) {
      console.warn("Could not create membership for new partner user:", err);
    }
  }

  await prisma.rentedMillSettings.upsert({
    where: { id: 1 },
    update: { partnerUserId: userId },
    create: { partnerUserId: userId },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `পার্টনার (${name}) সফলভাবে তৈরি ও সংযুক্ত করা হয়েছে।` };
}

// ───────────────────────────── 2. পার্টি (কাস্টমার) ─────────────────────────────

export async function createRentedMillPartyAction(formData: FormData) {
  await checkWriteAccess();

  const name = String(formData.get("name") || "").trim();
  const phone = String(formData.get("phone") || "").trim() || null;
  const address = String(formData.get("address") || "").trim() || null;
  const isSelfParty = formData.get("isSelfParty") === "true" || formData.get("isSelfParty") === "on";
  const openingBalance = parseFloat(String(formData.get("openingBalance") || "0")) || 0;

  if (!name) throw new Error("পার্টির নাম দেওয়া বাধ্যতামূলক।");

  const party = await prisma.rentedMillParty.create({
    data: {
      name,
      phone,
      address,
      isSelfParty,
      openingBalance,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, partyId: party.id, message: "পার্টি সফলভাবে যোগ করা হয়েছে।" };
}

// ───────────────────────────── 3. ধান ছাটাই বিল ─────────────────────────────

export async function createMillingBillAction(formData: FormData) {
  const { ctx, role } = await checkWriteAccess();

  let partyId = String(formData.get("partyId") || "").trim();
  const newPartyName = String(formData.get("newPartyName") || "").trim();

  if (!partyId && newPartyName) {
    const newParty = await prisma.rentedMillParty.create({
      data: {
        name: newPartyName,
        phone: String(formData.get("partyPhone") || "").trim() || null,
        address: String(formData.get("partyAddress") || "").trim() || null,
        isSelfParty: formData.get("isSelfParty") === "true",
      },
    });
    partyId = newParty.id;
  }

  if (!partyId) throw new Error("পার্টি নির্বাচন করুন অথবা নতুন পার্টির নাম লিখুন।");

  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(dateStr) : new Date();

  const paddyQuantity = parseFloat(String(formData.get("paddyQuantity") || "0")) || 0;
  const unit = String(formData.get("unit") || "বস্তা").trim();
  const millingRate = parseFloat(String(formData.get("millingRate") || "0")) || 0;
  const paidAmount = parseFloat(String(formData.get("paidAmount") || "0")) || 0;
  const notes = String(formData.get("notes") || "").trim() || null;

  if (paddyQuantity <= 0 || millingRate <= 0) {
    throw new Error("ধনের পরিমাণ এবং ছাটাই রেট ০ এর চেয়ে বেশি হতে হবে।");
  }

  const totalAmount = Math.round(paddyQuantity * millingRate);
  const dueAmount = Math.max(0, totalAmount - paidAmount);

  const status = role === "SUPER_ADMIN" ? "APPROVED" : "PENDING";

  // Generate bill number
  const count = await prisma.rentedMillBill.count();
  const billNo = `RMB-${(count + 1).toString().padStart(4, "0")}`;

  await prisma.rentedMillBill.create({
    data: {
      billNo,
      partyId,
      date,
      paddyQuantity,
      unit,
      millingRate,
      totalAmount,
      paidAmount,
      dueAmount,
      status,
      notes,
      createdByName: ctx.user.name || (role === "ACCOUNTANT" ? "হিসাবরক্ষক" : "অ্যাডমিন"),
      createdByUserId: ctx.user.id,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return {
    ok: true,
    billNo,
    status,
    message:
      status === "PENDING"
        ? `বিল নং ${billNo} সংরক্ষিত হয়েছে এবং সুপার অ্যাডমিনের অনুমোদনের অপেক্ষায় রয়েছে।`
        : `বিল নং ${billNo} সফলভাবে তৈরি ও অনুমোদিত হয়েছে।`,
  };
}

export async function updateMillingBillAction(billId: string, formData: FormData) {
  const bill = await prisma.rentedMillBill.findUnique({
    where: { id: billId },
  });
  if (!bill) throw new Error("বিলটি পাওয়া যায়নি।");
  if (bill.isSettled) {
    throw new Error("এই বিলটি ইতিমধ্যে লাভ-ক্ষতি নিষ্পত্তিতে অন্তর্ভুক্ত হয়েছে। সম্পাদনা করার পূর্বে সংশ্লিষ্ট নিষ্পত্তি রেকর্ড বাতিল করুন।");
  }

  await checkEditOrDeleteAccess(bill.status);

  const partyId = String(formData.get("partyId") || "").trim() || bill.partyId;
  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(dateStr) : bill.date;
  const paddyQuantity = parseFloat(String(formData.get("paddyQuantity") || "0")) || 0;
  const unit = String(formData.get("unit") || "বস্তা").trim();
  const millingRate = parseFloat(String(formData.get("millingRate") || "0")) || 0;
  const paidAmount = parseFloat(String(formData.get("paidAmount") || "0")) || 0;
  const notes = String(formData.get("notes") || "").trim() || null;

  if (paddyQuantity <= 0 || millingRate <= 0) {
    throw new Error("ধনের পরিমাণ এবং ছাটাই রেট ০ এর চেয়ে বেশি হতে হবে।");
  }

  const totalAmount = Math.round(paddyQuantity * millingRate);
  const dueAmount = Math.max(0, totalAmount - paidAmount);

  await prisma.rentedMillBill.update({
    where: { id: billId },
    data: {
      partyId,
      date,
      paddyQuantity,
      unit,
      millingRate,
      totalAmount,
      paidAmount,
      dueAmount,
      notes,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `বিল (${bill.billNo}) সফলভাবে হালনাগাদ করা হয়েছে।` };
}

export async function deleteMillingBillAction(billId: string) {
  const bill = await prisma.rentedMillBill.findUnique({
    where: { id: billId },
  });
  if (!bill) throw new Error("বিলটি পাওয়া যায়নি।");
  if (bill.isSettled) {
    throw new Error("এই বিলটি লাভ-ক্ষতি নিষ্পত্তিতে অন্তর্ভুক্ত হয়েছে। মুছে ফেলার পূর্বে নিষ্পত্তি রেকর্ড বাতিল করুন।");
  }

  await checkEditOrDeleteAccess(bill.status);

  await prisma.rentedMillBill.delete({
    where: { id: billId },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `বিল (${bill.billNo}) সফলভাবে মুছে ফেলা হয়েছে।` };
}

// ───────────────────────────── 4. ভুষি ও কুঁড়া বিক্রয় ─────────────────────────────

export async function createByproductSaleAction(formData: FormData) {
  const { ctx, role } = await checkWriteAccess();

  const customerName = String(formData.get("customerName") || "").trim();
  const customerPhone = String(formData.get("customerPhone") || "").trim() || null;
  const productType = String(formData.get("productType") || "ভুষি").trim();
  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(dateStr) : new Date();

  const quantity = parseFloat(String(formData.get("quantity") || "0")) || 0;
  const unit = String(formData.get("unit") || "কেজি").trim();
  const rate = parseFloat(String(formData.get("rate") || "0")) || 0;
  const paidAmount = parseFloat(String(formData.get("paidAmount") || "0")) || 0;
  const notes = String(formData.get("notes") || "").trim() || null;

  if (!customerName) throw new Error("ক্রেতার নাম দেওয়া বাধ্যতামূলক।");
  if (quantity <= 0 || rate <= 0) {
    throw new Error("পরিমাণ এবং দর ০ এর চেয়ে বেশি হতে হবে।");
  }

  const totalAmount = Math.round(quantity * rate);
  const dueAmount = Math.max(0, totalAmount - paidAmount);

  const status = role === "SUPER_ADMIN" ? "APPROVED" : "PENDING";

  const count = await prisma.rentedMillByproductSale.count();
  const invoiceNo = `RBS-${(count + 1).toString().padStart(4, "0")}`;

  await prisma.rentedMillByproductSale.create({
    data: {
      invoiceNo,
      customerName,
      customerPhone,
      productType,
      date,
      quantity,
      unit,
      rate,
      totalAmount,
      paidAmount,
      dueAmount,
      status,
      notes,
      createdByName: ctx.user.name || (role === "ACCOUNTANT" ? "হিসাবরক্ষক" : "অ্যাডমিন"),
      createdByUserId: ctx.user.id,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return {
    ok: true,
    invoiceNo,
    status,
    message:
      status === "PENDING"
        ? `ভুষি/কুঁড়া বিক্রয় (${invoiceNo}) সংরক্ষিত হয়েছে এবং অনুমোদনের অপেক্ষায় রয়েছে।`
        : `ভুষি/কুঁড়া বিক্রয় (${invoiceNo}) সফলভাবে সংরক্ষিত ও অনুমোদিত হয়েছে।`,
  };
}

export async function updateByproductSaleAction(saleId: string, formData: FormData) {
  const sale = await prisma.rentedMillByproductSale.findUnique({
    where: { id: saleId },
  });
  if (!sale) throw new Error("বিক্রয় রেকর্ডটি পাওয়া যায়নি।");
  if (sale.isSettled) {
    throw new Error("এই বিক্রয় রেকর্ডটি ইতিমধ্যে লাভ-ক্ষতি নিষ্পত্তিতে অন্তর্ভুক্ত হয়েছে। সম্পাদনা করার পূর্বে সংশ্লিষ্ট নিষ্পত্তি রেকর্ড বাতিল করুন।");
  }

  await checkEditOrDeleteAccess(sale.status);

  const customerName = String(formData.get("customerName") || "").trim() || sale.customerName;
  const customerPhone = String(formData.get("customerPhone") || "").trim() || null;
  const productType = String(formData.get("productType") || "ভুষি").trim();
  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(dateStr) : sale.date;
  const quantity = parseFloat(String(formData.get("quantity") || "0")) || 0;
  const unit = String(formData.get("unit") || "কেজি").trim();
  const rate = parseFloat(String(formData.get("rate") || "0")) || 0;
  const paidAmount = parseFloat(String(formData.get("paidAmount") || "0")) || 0;
  const notes = String(formData.get("notes") || "").trim() || null;

  if (quantity <= 0 || rate <= 0) {
    throw new Error("পরিমাণ এবং দর ০ এর চেয়ে বেশি হতে হবে।");
  }

  const totalAmount = Math.round(quantity * rate);
  const dueAmount = Math.max(0, totalAmount - paidAmount);

  await prisma.rentedMillByproductSale.update({
    where: { id: saleId },
    data: {
      customerName,
      customerPhone,
      productType,
      date,
      quantity,
      unit,
      rate,
      totalAmount,
      paidAmount,
      dueAmount,
      notes,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `ভুষি/কুঁড়া বিক্রয় (${sale.invoiceNo}) সফলভাবে হালনাগাদ করা হয়েছে।` };
}

export async function deleteByproductSaleAction(saleId: string) {
  const sale = await prisma.rentedMillByproductSale.findUnique({
    where: { id: saleId },
  });
  if (!sale) throw new Error("বিক্রয় রেকর্ডটি পাওয়া যায়নি।");
  if (sale.isSettled) {
    throw new Error("এই বিক্রয় রেকর্ডটি লাভ-ক্ষতি নিষ্পত্তিতে অন্তর্ভুক্ত হয়েছে। মুছে ফেলার পূর্বে নিষ্পত্তি রেকর্ড বাতিল করুন।");
  }

  await checkEditOrDeleteAccess(sale.status);

  await prisma.rentedMillByproductSale.delete({
    where: { id: saleId },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `ভুষি/কুঁড়া বিক্রয় (${sale.invoiceNo}) সফলভাবে মুছে ফেলা হয়েছে।` };
}

// ───────────────────────────── 5. মিল ভাড়া ও যাবতীয় খরচ ─────────────────────────────

export async function createRentedMillExpenseAction(formData: FormData) {
  const { ctx, role } = await checkWriteAccess();

  const category = String(
    formData.get("category") || formData.get("expenseCategory") || "অন্যান্য খরচ"
  ).trim();
  const dateStr = String(formData.get("date") || formData.get("expenseDate") || "").trim();
  let date = new Date();
  if (dateStr) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  const rawAmount = formData.get("amount") || formData.get("expenseAmount") || "0";
  const amount = typeof rawAmount === "number" ? rawAmount : parseFloat(String(rawAmount)) || 0;
  const description = String(formData.get("description") || formData.get("notes") || "").trim() || null;
  const paidTo = String(formData.get("paidTo") || "").trim() || null;

  if (amount <= 0) throw new Error("খরচের পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");

  const status = role === "SUPER_ADMIN" ? "APPROVED" : "PENDING";

  const count = await prisma.rentedMillExpense.count();
  const expenseNo = `RME-${(count + 1).toString().padStart(4, "0")}`;

  await prisma.rentedMillExpense.create({
    data: {
      expenseNo,
      category,
      date,
      amount,
      description,
      paidTo,
      status,
      createdByName: ctx.user.name || (role === "ACCOUNTANT" ? "হিসাবরক্ষক" : "অ্যাডমিন"),
      createdByUserId: ctx.user.id,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return {
    ok: true,
    expenseNo,
    status,
    message:
      status === "PENDING"
        ? `খরচ এন্ট্রি (${expenseNo}) সংরক্ষিত হয়েছে এবং অনুমোদনের অপেক্ষায় রয়েছে। ড্যাশবোর্ডের "অনুমোদনের অপেক্ষায়" তালিকা থেকে মালিক অনুমোদন দিলে চূড়ান্ত তালিকায় যোগ হবে।`
        : `খরচ এন্ট্রি (${expenseNo}) সফলভাবে সংরক্ষিত ও অনুমোদিত হয়েছে।`,
  };
}

export async function updateRentedMillExpenseAction(expenseId: string, formData: FormData) {
  const expense = await prisma.rentedMillExpense.findUnique({
    where: { id: expenseId },
  });
  if (!expense) throw new Error("খরচ রেকর্ডটি পাওয়া যায়নি।");
  if (expense.isSettled) {
    throw new Error("এই খরচ এন্ট্রিটি ইতিমধ্যে লাভ-ক্ষতি নিষ্পত্তিতে অন্তর্ভুক্ত হয়েছে। সম্পাদনা করার পূর্বে সংশ্লিষ্ট নিষ্পত্তি রেকর্ড বাতিল করুন।");
  }

  await checkEditOrDeleteAccess(expense.status);

  const category =
    String(formData.get("category") || formData.get("expenseCategory") || "").trim() || expense.category;
  const dateStr = String(formData.get("date") || formData.get("expenseDate") || "").trim();
  let date = expense.date;
  if (dateStr) {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      date = parsed;
    }
  }
  const rawAmount = formData.get("amount") || formData.get("expenseAmount") || "0";
  const amount = typeof rawAmount === "number" ? rawAmount : parseFloat(String(rawAmount)) || 0;
  const description = String(formData.get("description") || formData.get("notes") || "").trim() || null;
  const paidTo = String(formData.get("paidTo") || "").trim() || null;

  if (amount <= 0) throw new Error("খরচের পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");

  await prisma.rentedMillExpense.update({
    where: { id: expenseId },
    data: {
      category,
      date,
      amount,
      description,
      paidTo,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `খরচ এন্ট্রি (${expense.expenseNo}) সফলভাবে হালনাগাদ করা হয়েছে।` };
}

export async function deleteRentedMillExpenseAction(expenseId: string) {
  const expense = await prisma.rentedMillExpense.findUnique({
    where: { id: expenseId },
  });
  if (!expense) throw new Error("খরচ রেকর্ডটি পাওয়া যায়নি।");
  if (expense.isSettled) {
    throw new Error("এই খরচ এন্ট্রিটি লাভ-ক্ষতি নিষ্পত্তিতে অন্তর্ভুক্ত হয়েছে। মুছে ফেলার পূর্বে নিষ্পত্তি রেকর্ড বাতিল করুন।");
  }

  await checkEditOrDeleteAccess(expense.status);

  await prisma.rentedMillExpense.delete({
    where: { id: expenseId },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `খরচ এন্ট্রি (${expense.expenseNo}) সফলভাবে মুছে ফেলা হয়েছে।` };
}

// ───────────────────────────── 6. পার্টির বকেয়া আদায় / পেমেন্ট ─────────────────────────────

export async function createPartyPaymentAction(formData: FormData) {
  const { ctx, role } = await checkWriteAccess();

  const partyId = String(formData.get("partyId") || "").trim();
  if (!partyId) throw new Error("পার্টি নির্বাচন করা বাধ্যতামূলক।");

  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(dateStr) : new Date();
  const amount = parseFloat(String(formData.get("amount") || "0")) || 0;
  const paymentMethod = String(formData.get("paymentMethod") || "নগদ").trim();
  const notes = String(formData.get("notes") || "").trim() || null;

  if (amount <= 0) throw new Error("আদায়ের পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");

  const status = role === "SUPER_ADMIN" ? "APPROVED" : "PENDING";

  const count = await prisma.rentedMillPayment.count();
  const receiptNo = `RMR-${(count + 1).toString().padStart(4, "0")}`;

  await prisma.rentedMillPayment.create({
    data: {
      receiptNo,
      partyId,
      date,
      amount,
      paymentMethod,
      status,
      notes,
      createdByName: ctx.user.name || (role === "ACCOUNTANT" ? "হিসাবরক্ষক" : "অ্যাডমিন"),
      createdByUserId: ctx.user.id,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return {
    ok: true,
    receiptNo,
    status,
    message:
      status === "PENDING"
        ? `টাকা গ্রহণ রশিদ (${receiptNo}) সংরক্ষিত হয়েছে এবং অনুমোদনের অপেক্ষায় রয়েছে।`
        : `টাকা গ্রহণ রশিদ (${receiptNo}) সফলভাবে সংরক্ষিত ও অনুমোদিত হয়েছে।`,
  };
}

export async function updatePartyPaymentAction(paymentId: string, formData: FormData) {
  const payment = await prisma.rentedMillPayment.findUnique({
    where: { id: paymentId },
  });
  if (!payment) throw new Error("পেমেন্ট রেকর্ডটি পাওয়া যায়নি।");

  await checkEditOrDeleteAccess(payment.status);

  const partyId = String(formData.get("partyId") || "").trim() || payment.partyId;
  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(dateStr) : payment.date;
  const amount = parseFloat(String(formData.get("amount") || "0")) || 0;
  const paymentMethod = String(formData.get("paymentMethod") || "নগদ").trim();
  const notes = String(formData.get("notes") || "").trim() || null;

  if (amount <= 0) throw new Error("আদায়ের পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");

  await prisma.rentedMillPayment.update({
    where: { id: paymentId },
    data: {
      partyId,
      date,
      amount,
      paymentMethod,
      notes,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `টাকা গ্রহণ রশিদ (${payment.receiptNo}) সফলভাবে হালনাগাদ করা হয়েছে।` };
}

export async function deletePartyPaymentAction(paymentId: string) {
  const payment = await prisma.rentedMillPayment.findUnique({
    where: { id: paymentId },
  });
  if (!payment) throw new Error("পেমেন্ট রেকর্ডটি পাওয়া যায়নি।");

  await checkEditOrDeleteAccess(payment.status);

  await prisma.rentedMillPayment.delete({
    where: { id: paymentId },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `পেমেন্ট রেকর্ড (${payment.receiptNo}) সফলভাবে মুছে ফেলা হয়েছে।` };
}

// ───────────────────────────── 7. দৈনিক ধান প্রাপ্তি ─────────────────────────────

export async function createPaddyReceiptAction(formData: FormData) {
  const { ctx, role } = await checkWriteAccess();

  let partyId = String(formData.get("partyId") || "").trim();
  const newPartyName = String(formData.get("newPartyName") || "").trim();

  if (!partyId && newPartyName) {
    const newParty = await prisma.rentedMillParty.create({
      data: {
        name: newPartyName,
        phone: String(formData.get("partyPhone") || "").trim() || null,
        address: String(formData.get("partyAddress") || "").trim() || null,
        isSelfParty: formData.get("isSelfParty") === "true",
      },
    });
    partyId = newParty.id;
  }

  if (!partyId) throw new Error("পার্টি নির্বাচন করুন অথবা নতুন পার্টির নাম লিখুন।");

  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(dateStr) : new Date();
  const receiptTime = String(formData.get("receiptTime") || "").trim() || null;
  const paddyName = String(formData.get("paddyName") || "ব্রি-২৮").trim();

  const juteBags = parseInt(String(formData.get("juteBags") || "0"), 10) || 0;
  const plasticBags = parseInt(String(formData.get("plasticBags") || "0"), 10) || 0;
  let bagsCount = parseInt(String(formData.get("bagsCount") || "0"), 10) || 0;
  if (juteBags > 0 || plasticBags > 0) {
    bagsCount = juteBags + plasticBags;
  }

  const sklWeight = parseFloat(String(formData.get("sklWeight") || formData.get("grossSkl") || "0")) || 0;

  // Dhalta calculation: Jute 1.5kg, Plastic 0.5kg (or manual override)
  const autoDhalta = Number((juteBags * 1.5 + plasticBags * 0.5).toFixed(2));
  const rawDhalta = formData.get("dhaltaKg");
  const dhaltaKg = rawDhalta !== null && String(rawDhalta).trim() !== "" ? parseFloat(String(rawDhalta)) || 0 : autoDhalta;

  // Net SKL = Gross SKL - Total Dhalta
  const netSklKg = Math.max(0, Number((sklWeight - dhaltaKg).toFixed(2)));

  // Standard 75kg bags = Net SKL / 75
  const standardBags75kg = Number((netSklKg / 75).toFixed(2));

  // Milling/Dryer rate per standard 75kg bag
  const ratePerStandardBag = parseFloat(String(formData.get("ratePerStandardBag") || "100")) || 0;
  const totalBillAmount = Math.round(standardBags75kg * ratePerStandardBag);

  const notes = String(formData.get("notes") || "").trim() || null;

  if (sklWeight <= 0) {
    throw new Error("স্কেল ওজন (কেজি) ০ এর চেয়ে বেশি হতে হবে।");
  }

  const status = role === "SUPER_ADMIN" ? "APPROVED" : "PENDING";

  const count = await prisma.rentedMillPaddyReceipt.count();
  const receiptNo = `RPR-${(count + 1).toString().padStart(4, "0")}`;

  await prisma.rentedMillPaddyReceipt.create({
    data: {
      receiptNo,
      partyId,
      date,
      receiptTime,
      paddyName,
      juteBags,
      plasticBags,
      bagsCount,
      sklWeight,
      dhaltaKg,
      netSklKg,
      standardBags75kg,
      ratePerStandardBag,
      totalBillAmount,
      status,
      notes,
      createdByName: ctx.user.name || (role === "ACCOUNTANT" ? "হিসাবরক্ষক" : "অ্যাডমিন"),
      createdByUserId: ctx.user.id,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return {
    ok: true,
    receiptNo,
    status,
    message:
      status === "PENDING"
        ? `ধান প্রাপ্তি রশিদ (${receiptNo}) সংরক্ষিত হয়েছে এবং অনুমোদনের অপেক্ষায় রয়েছে।`
        : `ধান প্রাপ্তি রশিদ (${receiptNo}) সফলভাবে সংরক্ষিত ও অনুমোদিত হয়েছে।`,
  };
}

export async function updatePaddyReceiptAction(receiptId: string, formData: FormData) {
  const receipt = await prisma.rentedMillPaddyReceipt.findUnique({
    where: { id: receiptId },
  });
  if (!receipt) throw new Error("ধান প্রাপ্তি রেকর্ডটি পাওয়া যায়নি।");
  if (receipt.isSettled) {
    throw new Error("এই ধান প্রাপ্তি রশিদটি ইতিমধ্যে লাভ-ক্ষতি নিষ্পত্তিতে অন্তর্ভুক্ত হয়েছে। সম্পাদনা করার পূর্বে সংশ্লিষ্ট নিষ্পত্তি রেকর্ড বাতিল করুন।");
  }

  await checkEditOrDeleteAccess(receipt.status);

  const partyId = String(formData.get("partyId") || "").trim() || receipt.partyId;
  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(dateStr) : receipt.date;
  const receiptTime = String(formData.get("receiptTime") || "").trim() || receipt.receiptTime;
  const paddyName = String(formData.get("paddyName") || "").trim() || receipt.paddyName;

  const juteBags = parseInt(String(formData.get("juteBags") || "0"), 10) || 0;
  const plasticBags = parseInt(String(formData.get("plasticBags") || "0"), 10) || 0;
  const bagsCount = juteBags + plasticBags;
  const sklWeight = parseFloat(String(formData.get("sklWeight") || "0")) || 0;

  if (sklWeight <= 0) {
    throw new Error("স্কেল ওজন (কেজি) ০ এর চেয়ে বেশি হতে হবে।");
  }

  // Dhalta
  const rawDhalta = formData.get("dhaltaKg");
  let dhaltaKg = rawDhalta !== null && rawDhalta !== "" ? parseFloat(String(rawDhalta)) : 0;
  if (isNaN(dhaltaKg) || dhaltaKg < 0) {
    dhaltaKg = Number((juteBags * 1.5 + plasticBags * 0.5).toFixed(2));
  }

  const netSklKg = Math.max(0, Number((sklWeight - dhaltaKg).toFixed(2)));
  const standardBags75kg = Number((netSklKg / 75).toFixed(2));
  const ratePerStandardBag = parseFloat(String(formData.get("ratePerStandardBag") || "100")) || 0;
  const totalBillAmount = Math.round(standardBags75kg * ratePerStandardBag);
  const notes = String(formData.get("notes") || "").trim() || null;

  await prisma.rentedMillPaddyReceipt.update({
    where: { id: receiptId },
    data: {
      partyId,
      date,
      receiptTime,
      paddyName,
      juteBags,
      plasticBags,
      bagsCount,
      sklWeight,
      dhaltaKg,
      netSklKg,
      standardBags75kg,
      ratePerStandardBag,
      totalBillAmount,
      notes,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `ধান প্রাপ্তি রশিদ (${receipt.receiptNo}) সফলভাবে হালনাগাদ করা হয়েছে।` };
}

export async function deletePaddyReceiptAction(receiptId: string) {
  const receipt = await prisma.rentedMillPaddyReceipt.findUnique({
    where: { id: receiptId },
  });
  if (!receipt) throw new Error("ধান প্রাপ্তি রেকর্ডটি পাওয়া যায়নি।");
  if (receipt.isSettled) {
    throw new Error("এই ধান প্রাপ্তি রশিদটি লাভ-ক্ষতি নিষ্পত্তিতে অন্তর্ভুক্ত হয়েছে। মুছে ফেলার পূর্বে নিষ্পত্তি রেকর্ড বাতিল করুন।");
  }

  await checkEditOrDeleteAccess(receipt.status);

  await prisma.rentedMillPaddyReceipt.delete({
    where: { id: receiptId },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `ধান প্রাপ্তি রেকর্ড (${receipt.receiptNo}) সফলভাবে মুছে ফেলা হয়েছে।` };
}

// ───────────────────────────── 8. দৈনিক ডায়ার ও ছাটাই ─────────────────────────────

export async function createDryerMillingAction(formData: FormData) {
  const { ctx, role } = await checkWriteAccess();

  const partyId = String(formData.get("partyId") || "").trim();
  if (!partyId) throw new Error("পার্টি নির্বাচন করা বাধ্যতামূলক।");

  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(dateStr) : new Date();
  const dryerNo = String(formData.get("dryerNo") || "ডায়ার-১").trim();
  const usedBags = parseFloat(String(formData.get("usedBags") || "0")) || 0;
  const milledKg = parseFloat(String(formData.get("milledKg") || "0")) || 0;
  const notes = String(formData.get("notes") || "").trim() || null;

  if (usedBags <= 0 && milledKg <= 0) {
    throw new Error("ব্যবহৃত বস্তা বা ছাটাইকৃত কেজি ০ এর চেয়ে বেশি হতে হবে।");
  }

  const status = role === "SUPER_ADMIN" ? "APPROVED" : "PENDING";

  const count = await prisma.rentedMillDryerMilling.count();
  const entryNo = `RDM-${(count + 1).toString().padStart(4, "0")}`;

  await prisma.rentedMillDryerMilling.create({
    data: {
      entryNo,
      partyId,
      date,
      dryerNo,
      usedBags,
      milledKg,
      status,
      notes,
      createdByName: ctx.user.name || (role === "ACCOUNTANT" ? "হিসাবরক্ষক" : "অ্যাডমিন"),
      createdByUserId: ctx.user.id,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return {
    ok: true,
    entryNo,
    status,
    message:
      status === "PENDING"
        ? `ডায়ার / ছাটাই এন্ট্রি (${entryNo}) সংরক্ষিত হয়েছে এবং অনুমোদনের অপেক্ষায় রয়েছে।`
        : `ডায়ার / ছাটাই এন্ট্রি (${entryNo}) সফলভাবে সংরক্ষিত ও অনুমোদিত হয়েছে।`,
  };
}

export async function updateDryerMillingAction(entryId: string, formData: FormData) {
  const entry = await prisma.rentedMillDryerMilling.findUnique({
    where: { id: entryId },
  });
  if (!entry) throw new Error("ডায়ার / ছাটাই রেকর্ডটি পাওয়া যায়নি।");

  await checkEditOrDeleteAccess(entry.status);

  const partyId = String(formData.get("partyId") || "").trim() || entry.partyId;
  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(dateStr) : entry.date;
  const dryerNo = String(formData.get("dryerNo") || "").trim() || entry.dryerNo;
  const usedBags = parseFloat(String(formData.get("usedBags") || "0")) || 0;
  const milledKg = parseFloat(String(formData.get("milledKg") || "0")) || 0;
  const notes = String(formData.get("notes") || "").trim() || null;

  if (usedBags <= 0 && milledKg <= 0) {
    throw new Error("ব্যবহৃত বস্তা বা ছাটাইকৃত কেজি ০ এর চেয়ে বেশি হতে হবে।");
  }

  await prisma.rentedMillDryerMilling.update({
    where: { id: entryId },
    data: {
      partyId,
      date,
      dryerNo,
      usedBags,
      milledKg,
      notes,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `ডায়ার / ছাটাই এন্ট্রি (${entry.entryNo}) সফলভাবে হালনাগাদ করা হয়েছে।` };
}

export async function deleteDryerMillingAction(entryId: string) {
  const entry = await prisma.rentedMillDryerMilling.findUnique({
    where: { id: entryId },
  });
  if (!entry) throw new Error("ডায়ার / ছাটাই রেকর্ডটি পাওয়া যায়নি।");

  await checkEditOrDeleteAccess(entry.status);

  await prisma.rentedMillDryerMilling.delete({
    where: { id: entryId },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `ডায়ার / ছাটাই রেকর্ড (${entry.entryNo}) সফলভাবে মুছে ফেলা হয়েছে।` };
}

// ───────────────────────────── 9. যাচাই ও অনুমোদন (Approve / Reject) ─────────────────────────────

export async function approveRentedMillEntryAction({
  type,
  id,
}: {
  type: "PAYMENT" | "EXPENSE" | "PADDY_RECEIPT" | "DRYER_MILLING" | "MILLING_BILL" | "BYPRODUCT_SALE" | "FUND_TRANSACTION";
  id: string;
}) {
  const { ctx } = await checkAdminAccess();

  if (type === "PAYMENT") {
    await prisma.rentedMillPayment.update({ where: { id }, data: { status: "APPROVED" } });
  } else if (type === "EXPENSE") {
    await prisma.rentedMillExpense.update({ where: { id }, data: { status: "APPROVED" } });
  } else if (type === "PADDY_RECEIPT") {
    await prisma.rentedMillPaddyReceipt.update({ where: { id }, data: { status: "APPROVED" } });
  } else if (type === "DRYER_MILLING") {
    await prisma.rentedMillDryerMilling.update({ where: { id }, data: { status: "APPROVED" } });
  } else if (type === "MILLING_BILL") {
    await prisma.rentedMillBill.update({ where: { id }, data: { status: "APPROVED" } });
  } else if (type === "BYPRODUCT_SALE") {
    await prisma.rentedMillByproductSale.update({ where: { id }, data: { status: "APPROVED" } });
  } else if (type === "FUND_TRANSACTION") {
    const tx = await prisma.rentedMillFundTransaction.findUnique({ where: { id } });
    if (!tx) throw new Error("তহবিল এন্ট্রি পাওয়া যায়নি।");
    await prisma.rentedMillFundTransaction.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedByName: ctx.user.name,
        approvedByUserId: ctx.user.id,
        approvedAt: new Date(),
      },
    });
    if (tx.bankAccountId) {
      await recomputeBankBalance(tx.bankAccountId);
    }
  } else {
    throw new Error("অকার্যকর এন্ট্রি ধরণ।");
  }

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: "এন্ট্রিটি সফলভাবে অনুমোদন করা হয়েছে এবং মূল হিসেবে যুক্ত হয়েছে।" };
}

export async function rejectRentedMillEntryAction({
  type,
  id,
}: {
  type: "PAYMENT" | "EXPENSE" | "PADDY_RECEIPT" | "DRYER_MILLING" | "MILLING_BILL" | "BYPRODUCT_SALE" | "FUND_TRANSACTION";
  id: string;
}) {
  await checkAdminAccess();

  if (type === "PAYMENT") {
    await prisma.rentedMillPayment.update({ where: { id }, data: { status: "REJECTED" } });
  } else if (type === "EXPENSE") {
    await prisma.rentedMillExpense.update({ where: { id }, data: { status: "REJECTED" } });
  } else if (type === "PADDY_RECEIPT") {
    await prisma.rentedMillPaddyReceipt.update({ where: { id }, data: { status: "REJECTED" } });
  } else if (type === "DRYER_MILLING") {
    await prisma.rentedMillDryerMilling.update({ where: { id }, data: { status: "REJECTED" } });
  } else if (type === "MILLING_BILL") {
    await prisma.rentedMillBill.update({ where: { id }, data: { status: "REJECTED" } });
  } else if (type === "BYPRODUCT_SALE") {
    await prisma.rentedMillByproductSale.update({ where: { id }, data: { status: "REJECTED" } });
  } else if (type === "FUND_TRANSACTION") {
    const tx = await prisma.rentedMillFundTransaction.findUnique({ where: { id } });
    await prisma.rentedMillFundTransaction.update({ where: { id }, data: { status: "REJECTED" } });
    if (tx?.bankAccountId) {
      await recomputeBankBalance(tx.bankAccountId);
    }
  } else {
    throw new Error("অকার্যকর এন্ট্রি ধরণ।");
  }

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: "এন্ট্রিটি বাতিল করা হয়েছে।" };
}

// ───────────────────────────── ৭. লাভ-ক্ষতি ও ৫০:৫০ নিষ্পত্তি (Settlement) ─────────────────────────────

export async function createSettlementAction(formData: FormData) {
  const { ctx } = await checkAdminAccess();

  const fromDateStr = String(formData.get("fromDate") || "").trim();
  const toDateStr = String(formData.get("toDate") || "").trim();
  const notes = String(formData.get("notes") || "").trim() || null;

  if (!fromDateStr || !toDateStr) {
    throw new Error("শুরুর তারিখ এবং শেষ তারিখ নির্বাচন করা আবশ্যক।");
  }

  const fromDate = new Date(`${fromDateStr}T00:00:00`);
  const toDate = new Date(`${toDateStr}T23:59:59`);

  if (fromDate > toDate) {
    throw new Error("শুরুর তারিখ অবশ্যই শেষ তারিখের চেয়ে পূর্বে হতে হবে।");
  }

  const settings = await getRentedMillSettings();

  // Fetch approved & unsettled transactions in range
  const [paddyReceipts, bills, byproductSales, expenses] = await Promise.all([
    prisma.rentedMillPaddyReceipt.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        status: "APPROVED",
        isSettled: false,
        totalBillAmount: { gt: 0 },
      },
      select: { id: true, totalBillAmount: true },
    }),
    prisma.rentedMillBill.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        status: "APPROVED",
        isSettled: false,
      },
      select: { id: true, totalAmount: true },
    }),
    prisma.rentedMillByproductSale.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        status: "APPROVED",
        isSettled: false,
      },
      select: { id: true, totalAmount: true },
    }),
    prisma.rentedMillExpense.findMany({
      where: {
        date: { gte: fromDate, lte: toDate },
        status: "APPROVED",
        isSettled: false,
      },
      select: { id: true, category: true, amount: true },
    }),
  ]);

  const totalEntries = paddyReceipts.length + bills.length + byproductSales.length + expenses.length;
  if (totalEntries === 0) {
    throw new Error("নির্বাচিত তারিখের মধ্যে নিষ্পত্তির মতো কোনো অনুমোদিত অনিষ্পত্তিকৃত লেনদেন পাওয়া যায়নি।");
  }

  const totalMillingIncome =
    paddyReceipts.reduce((sum, r) => sum + r.totalBillAmount, 0) +
    bills.reduce((sum, b) => sum + b.totalAmount, 0);

  const totalByproductIncome = byproductSales.reduce((sum, s) => sum + s.totalAmount, 0);
  const totalIncome = totalMillingIncome + totalByproductIncome;

  const totalRentExpense = expenses
    .filter((e) => e.category === "মাসিক মিল ভাড়া")
    .reduce((sum, e) => sum + e.amount, 0);

  const totalOtherExpense = expenses
    .filter((e) => e.category !== "মাসিক মিল ভাড়া")
    .reduce((sum, e) => sum + e.amount, 0);

  const totalExpense = totalRentExpense + totalOtherExpense;
  const netProfit = totalIncome - totalExpense;

  const p1Share = settings.partner1Share || 50;
  const p2Share = settings.partner2Share || 50;
  const partner1Amount = Math.round((netProfit * p1Share) / 100);
  const partner2Amount = Math.round((netProfit * p2Share) / 100);

  const count = await prisma.rentedMillSettlement.count();
  const settlementNo = `RMS-${String(count + 1).padStart(4, "0")}`;

  const settlement = await prisma.$transaction(async (tx) => {
    const s = await tx.rentedMillSettlement.create({
      data: {
        settlementNo,
        fromDate,
        toDate,
        totalMillingIncome,
        totalByproductIncome,
        totalIncome,
        totalRentExpense,
        totalOtherExpense,
        totalExpense,
        netProfit,
        partner1Name: settings.partner1Name || "নাহিদ হাসান",
        partner1Share: p1Share,
        partner1Amount,
        partner2Name: settings.partner2Name || "পার্টনার",
        partner2Share: p2Share,
        partner2Amount,
        status: "SETTLED",
        notes,
        settledByName: ctx.user.name || "অ্যাডমিন",
        settledByUserId: ctx.user.id,
      },
    });

    if (paddyReceipts.length > 0) {
      await tx.rentedMillPaddyReceipt.updateMany({
        where: { id: { in: paddyReceipts.map((r) => r.id) } },
        data: { settlementId: s.id, isSettled: true },
      });
    }

    if (bills.length > 0) {
      await tx.rentedMillBill.updateMany({
        where: { id: { in: bills.map((b) => b.id) } },
        data: { settlementId: s.id, isSettled: true },
      });
    }

    if (byproductSales.length > 0) {
      await tx.rentedMillByproductSale.updateMany({
        where: { id: { in: byproductSales.map((s) => s.id) } },
        data: { settlementId: s.id, isSettled: true },
      });
    }

    if (expenses.length > 0) {
      await tx.rentedMillExpense.updateMany({
        where: { id: { in: expenses.map((e) => e.id) } },
        data: { settlementId: s.id, isSettled: true },
      });
    }

    return s;
  });

  revalidatePath("/rented-mill", "layout");
  return {
    ok: true,
    settlementNo: settlement.settlementNo,
    message: `${settlement.settlementNo} নং মেয়াদের লাভ-ক্ষতি ও ৫০:৫০ বণ্টন সফলভাবে চূড়ান্ত নিষ্পত্তি করা হয়েছে।`,
  };
}

export async function deleteSettlementAction(settlementId: string) {
  await checkAdminAccess();

  await prisma.$transaction(async (tx) => {
    await tx.rentedMillPaddyReceipt.updateMany({
      where: { settlementId },
      data: { settlementId: null, isSettled: false },
    });
    await tx.rentedMillBill.updateMany({
      where: { settlementId },
      data: { settlementId: null, isSettled: false },
    });
    await tx.rentedMillByproductSale.updateMany({
      where: { settlementId },
      data: { settlementId: null, isSettled: false },
    });
    await tx.rentedMillExpense.updateMany({
      where: { settlementId },
      data: { settlementId: null, isSettled: false },
    });
    await tx.rentedMillSettlement.delete({
      where: { id: settlementId },
    });
  });

  revalidatePath("/rented-mill", "layout");
  return {
    ok: true,
    message: "নিষ্পত্তি রেকর্ডটি বাতিল করা হয়েছে এবং সংশ্লিষ্ট লেনদেনগুলো পুনরায় অনিষ্পত্তিকৃত অবস্থায় ফেরত নেওয়া হয়েছে।",
  };
}

// ───────────────────────────── ১০. ব্যাংক ও মালিকদের মূলধন / তহবিল লেনদেন ─────────────────────────────

export async function recomputeBankBalance(bankAccountId: string) {
  const bank = await prisma.rentedMillBankAccount.findUnique({
    where: { id: bankAccountId },
    select: { openingBalance: true },
  });
  if (!bank) return 0;

  const txs = await prisma.rentedMillFundTransaction.findMany({
    where: { bankAccountId, status: "APPROVED" },
    select: { partyType: true, transactionType: true, medium: true, amount: true },
  });

  let balance = bank.openingBalance;
  for (const t of txs) {
    const isBankInflow =
      (t.partyType === "BANK" && t.transactionType === "DEPOSIT") ||
      ((t.partyType === "OWNER_1" || t.partyType === "OWNER_2") && t.medium === "BANK" && t.transactionType === "DEPOSIT");
    const isBankOutflow =
      (t.partyType === "BANK" && t.transactionType === "WITHDRAW") ||
      ((t.partyType === "OWNER_1" || t.partyType === "OWNER_2") && t.medium === "BANK" && t.transactionType === "WITHDRAW");

    if (isBankInflow) balance += t.amount;
    else if (isBankOutflow) balance -= t.amount;
  }

  await prisma.rentedMillBankAccount.update({
    where: { id: bankAccountId },
    data: { currentBalance: balance },
  });

  return balance;
}

export async function createRentedMillBankAccountAction(formData: FormData) {
  await checkWriteAccess();
  const bankName = String(formData.get("bankName") || "").trim();
  const accountName = String(formData.get("accountName") || "").trim() || null;
  const accountNumber = String(formData.get("accountNumber") || "").trim();
  const branchName = String(formData.get("branchName") || "").trim() || null;
  const openingBalance = parseFloat(String(formData.get("openingBalance") || "0")) || 0;
  const notes = String(formData.get("notes") || "").trim() || null;

  if (!bankName || !accountNumber) {
    throw new Error("ব্যাংকের নাম এবং হিসাব নং দেওয়া বাধ্যতামূলক।");
  }

  const bank = await prisma.rentedMillBankAccount.create({
    data: {
      bankName,
      accountName,
      accountNumber,
      branchName,
      openingBalance,
      currentBalance: openingBalance,
      notes,
      isActive: true,
    },
  });

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `ব্যাংক হিসাব (${bank.bankName}) সফলভাবে যুক্ত করা হয়েছে।`, bank };
}

export async function updateRentedMillBankAccountAction(formData: FormData) {
  await checkWriteAccess();
  const id = String(formData.get("id") || "").trim();
  const bankName = String(formData.get("bankName") || "").trim();
  const accountName = String(formData.get("accountName") || "").trim() || null;
  const accountNumber = String(formData.get("accountNumber") || "").trim();
  const branchName = String(formData.get("branchName") || "").trim() || null;
  const openingBalance = parseFloat(String(formData.get("openingBalance") || "0")) || 0;
  const notes = String(formData.get("notes") || "").trim() || null;
  const isActive = formData.get("isActive") !== "false";

  if (!id || !bankName || !accountNumber) {
    throw new Error("ব্যাংকের আইডি, নাম এবং হিসাব নং দেওয়া বাধ্যতামূলক।");
  }

  await prisma.rentedMillBankAccount.update({
    where: { id },
    data: {
      bankName,
      accountName,
      accountNumber,
      branchName,
      openingBalance,
      notes,
      isActive,
    },
  });

  await recomputeBankBalance(id);
  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: "ব্যাংক হিসাব সফলভাবে হালনাগাদ করা হয়েছে।" };
}

export async function deleteRentedMillBankAccountAction(id: string) {
  await checkAdminAccess();
  const txCount = await prisma.rentedMillFundTransaction.count({ where: { bankAccountId: id } });
  if (txCount > 0) {
    await prisma.rentedMillBankAccount.update({ where: { id }, data: { isActive: false } });
    revalidatePath("/rented-mill", "layout");
    return { ok: true, message: "ব্যাংক হিসেবে লেনদেন থাকায় এটি নিষ্ক্রিয় (Inactive) করা হয়েছে।" };
  }
  await prisma.rentedMillBankAccount.delete({ where: { id } });
  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: "ব্যাংক হিসাব সফলভাবে মুছে ফেলা হয়েছে।" };
}

export async function createFundTransactionAction(formData: FormData) {
  const { ctx, role } = await checkWriteAccess();

  const partyType = String(formData.get("partyType") || "BANK") as "BANK" | "OWNER_1" | "OWNER_2";
  const partnerName = String(formData.get("partnerName") || "").trim() || null;
  const transactionType = String(formData.get("transactionType") || "DEPOSIT") as "DEPOSIT" | "WITHDRAW";
  const medium = String(formData.get("medium") || "CASH") as "CASH" | "BANK";
  const bankAccountId = String(formData.get("bankAccountId") || "").trim() || null;
  const amount = parseFloat(String(formData.get("amount") || "0")) || 0;
  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const reference = String(formData.get("reference") || "").trim() || null;

  if (amount <= 0) {
    throw new Error("টাকার পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");
  }

  if (partyType === "BANK" && !bankAccountId) {
    throw new Error("ব্যাংক লেনদেনের জন্য ব্যাংক অ্যাকাউন্ট নির্বাচন করা আবশ্যক।");
  }
  if (medium === "BANK" && !bankAccountId) {
    throw new Error("ব্যাংক মাধ্যমে লেনদেনের জন্য ব্যাংক অ্যাকাউন্ট নির্বাচন করা আবশ্যক।");
  }

  const status = role === "SUPER_ADMIN" ? "APPROVED" : "PENDING";
  const count = await prisma.rentedMillFundTransaction.count();
  const transactionNo = `RFT-${(count + 1).toString().padStart(4, "0")}`;

  const tx = await prisma.rentedMillFundTransaction.create({
    data: {
      transactionNo,
      date,
      partyType,
      partnerName,
      transactionType,
      medium,
      bankAccountId,
      amount,
      reference,
      status,
      createdByName: ctx.user.name || "হিসাবরক্ষক",
      createdByUserId: ctx.user.id,
      ...(status === "APPROVED"
        ? {
            approvedByName: ctx.user.name,
            approvedByUserId: ctx.user.id,
            approvedAt: new Date(),
          }
        : {}),
    },
  });

  if (status === "APPROVED" && bankAccountId) {
    await recomputeBankBalance(bankAccountId);
  }

  revalidatePath("/rented-mill", "layout");
  return {
    ok: true,
    message:
      status === "APPROVED"
        ? "তহবিল লেনদেন সফলভাবে সংরক্ষিত ও অনুমোদিত হয়েছে।"
        : "তহবিল লেনদেন সফলভাবে জমা হয়েছে, মালিকের অনুমোদনের অপেক্ষায় রয়েছে।",
    tx,
  };
}

export async function updateFundTransactionAction(formData: FormData) {
  const id = String(formData.get("id") || "").trim();
  const tx = await prisma.rentedMillFundTransaction.findUnique({ where: { id } });
  if (!tx) throw new Error("লেনদেনটি পাওয়া যায়নি।");

  await checkEditOrDeleteAccess(tx.status);

  const partyType = String(formData.get("partyType") || tx.partyType) as "BANK" | "OWNER_1" | "OWNER_2";
  const partnerName = String(formData.get("partnerName") || "").trim() || null;
  const transactionType = String(formData.get("transactionType") || tx.transactionType) as "DEPOSIT" | "WITHDRAW";
  const medium = String(formData.get("medium") || tx.medium) as "CASH" | "BANK";
  const bankAccountId = String(formData.get("bankAccountId") || "").trim() || null;
  const amount = parseFloat(String(formData.get("amount") || String(tx.amount))) || 0;
  const dateStr = String(formData.get("date") || "").trim();
  const date = dateStr ? new Date(`${dateStr}T12:00:00`) : tx.date;
  const reference = String(formData.get("reference") || "").trim() || null;

  if (amount <= 0) {
    throw new Error("টাকার পরিমাণ ০ এর চেয়ে বেশি হতে হবে।");
  }

  const oldBankAccountId = tx.bankAccountId;

  await prisma.rentedMillFundTransaction.update({
    where: { id },
    data: {
      partyType,
      partnerName,
      transactionType,
      medium,
      bankAccountId,
      amount,
      date,
      reference,
    },
  });

  if (tx.status === "APPROVED") {
    if (oldBankAccountId) await recomputeBankBalance(oldBankAccountId);
    if (bankAccountId && bankAccountId !== oldBankAccountId) await recomputeBankBalance(bankAccountId);
  }

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: "তহবিল লেনদেন সফলভাবে হালনাগাদ করা হয়েছে।" };
}

export async function deleteFundTransactionAction(id: string) {
  const tx = await prisma.rentedMillFundTransaction.findUnique({ where: { id } });
  if (!tx) throw new Error("লেনদেনটি পাওয়া যায়নি।");

  await checkEditOrDeleteAccess(tx.status);

  const bankAccountId = tx.bankAccountId;
  const wasApproved = tx.status === "APPROVED";

  await prisma.rentedMillFundTransaction.delete({ where: { id } });

  if (wasApproved && bankAccountId) {
    await recomputeBankBalance(bankAccountId);
  }

  revalidatePath("/rented-mill", "layout");
  return { ok: true, message: `তহবিল লেনদেন (${tx.transactionNo}) মুছে ফেলা হয়েছে।` };
}


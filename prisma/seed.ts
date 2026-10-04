// Idempotent seed — run with: npm run db:seed
//  1. first administrator from SEED_ADMIN_* env vars (only when no users exist)
//  2. a business for that admin (chart of accounts, units, warehouse, roles)
//  3. every business upgraded to the current default role set
//  4. optional realistic demo business (SEED_DEMO_DATA=true), posted through the real accounting services
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { toDateInput } from "../src/lib/format";
import { createBusiness, ensureDefaultRoles } from "../src/server/services/bootstrap";
import { setAccountOpening, systemAccounts, type Ctx } from "../src/server/services/accounting";
import { saveParty, saveProduct } from "../src/server/services/master";
import { saveCashVoucher, saveJournalVoucher, saveStockJournal, saveTradeVoucher } from "../src/server/services/voucher";

const DEMO_NAME = process.env.SEED_DEMO_BUSINESS_NAME || "রহমান এন্টারপ্রাইজ (ডেমো)";

/** Business dates are UTC-midnight of the Bangladesh calendar day (see src/lib/format.ts). */
function daysAgo(n: number) {
  const d = new Date(`${toDateInput()}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

async function main() {
  // 1. admin
  let admin = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!admin) {
    const email = (process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD || "";
    if (!email || password.length < 8) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 8 chars) to create the first admin.");
    admin = await prisma.user.create({ data: { name: process.env.SEED_ADMIN_NAME || "অ্যাডমিন", email, passwordHash: await bcrypt.hash(password, 12) } });
    console.log(`✔ admin user created: ${email}`);
  } else {
    console.log(`• users exist — admin seed skipped (${admin.email})`);
  }

  // 2. first business
  if (!(await prisma.membership.findFirst({ where: { userId: admin.id } }))) {
    const name = process.env.SEED_BUSINESS_NAME || "বিজয় ট্রেডার্স";
    await prisma.$transaction((tx) => createBusiness(tx, { name, ownerUserId: admin!.id, mobile: "01700000000", address: "ঢাকা, বাংলাদেশ" }), { timeout: 60_000 });
    console.log(`✔ business created: ${name}`);
  }

  // 3. roles
  for (const b of await prisma.business.findMany({ select: { id: true, name: true } })) {
    const added = await prisma.$transaction((tx) => ensureDefaultRoles(tx, b.id));
    if (added) console.log(`✔ ${added} default role(s) added to ${b.name}`);
  }

  // 4. demo business
  if (process.env.SEED_DEMO_DATA !== "true") return;
  if (await prisma.business.findFirst({ where: { name: DEMO_NAME, memberships: { some: { userId: admin.id } } } })) {
    console.log(`• demo business exists: ${DEMO_NAME}`);
    return;
  }
  const business = await prisma.$transaction(
    (tx) => createBusiness(tx, { name: DEMO_NAME, ownerUserId: admin!.id, mobile: "01711-223344", address: "১২/এ, মৌলভীবাজার, চকবাজার, ঢাকা-১২১১" }),
    { timeout: 60_000 },
  );
  await prisma.business.update({
    where: { id: business.id },
    data: { email: "info@rahman-enterprise.demo", binNumber: "000123456-0101", tinNumber: "123456789012", tradeLicense: "DNCC-2024-55210", defaultVatPercent: 0, invoiceTerms: "বিক্রিত মাল ফেরত নেওয়া হয় ৭ দিনের মধ্যে, রসিদসহ।" },
  });
  await populateDemo({ businessId: business.id, userId: admin.id });
  console.log(`✔ demo business "${DEMO_NAME}" created with realistic data (posted through the accounting engine)`);
}

async function populateDemo(ctx: Ctx) {
  const acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
  const accounts = await prisma.account.findMany({ where: { businessId: ctx.businessId } });
  const key = (k: string) => accounts.find((a) => a.systemKey === k)!.id;
  const BANK = key("BANK");
  const BKASH = key("MOBILE");
  const units = Object.fromEntries((await prisma.unit.findMany({ where: { businessId: ctx.businessId } })).map((u) => [u.name, u.id]));
  const warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: ctx.businessId, isDefault: true } })).id;

  // opening balances
  await prisma.$transaction((tx) => setAccountOpening(tx, ctx, acc.CASH, 85_000));
  await prisma.$transaction((tx) => setAccountOpening(tx, ctx, BANK, 4_25_000));
  await prisma.$transaction((tx) => setAccountOpening(tx, ctx, BKASH, 18_500));

  // catalogue
  const cat = async (name: string) => (await prisma.category.create({ data: { businessId: ctx.businessId, name } })).id;
  const brand = async (name: string) => (await prisma.brand.create({ data: { businessId: ctx.businessId, name } })).id;
  const C = { rice: await cat("চাল"), oil: await cat("ভোজ্য তেল"), dal: await cat("ডাল"), sugar: await cat("চিনি ও লবণ"), flour: await cat("আটা ও ময়দা"), bev: await cat("চা ও পানীয়"), care: await cat("সাবান ও প্রসাধনী"), med: await cat("ওষুধ") };
  const B = { local: await brand("দেশি"), teer: await brand("তীর"), fresh: await brand("ফ্রেশ"), pran: await brand("প্রাণ"), ispahani: await brand("ইস্পাহানি"), lux: await brand("লাক্স"), square: await brand("স্কয়ার") };
  const product = (name: string, code: string, barcode: string | null, categoryId: string, brandId: string, unit: string, purchasePrice: number, salePrice: number, wholesalePrice: number, minStock: number, openingStock: number, trackBatch = false) =>
    saveProduct(ctx, { name, code, barcode, categoryId, brandId, unitId: units[unit], purchasePrice, salePrice, wholesalePrice, minStock, openingStock, openingRate: purchasePrice, trackBatch });
  const P = {
    miniket: await product("মিনিকেট চাল", "P-001", "8941100100011", C.rice, B.local, "কেজি", 62, 70, 67, 200, 1_000),
    najir: await product("নাজিরশাইল চাল", "P-002", "8941100100028", C.rice, B.local, "কেজি", 72, 82, 78, 150, 600),
    oil5: await product("তীর সয়াবিন তেল ৫ লিটার", "P-003", "8941100200015", C.oil, B.teer, "পিস", 820, 870, 850, 15, 60),
    oil1: await product("তীর সয়াবিন তেল ১ লিটার", "P-004", "8941100200022", C.oil, B.teer, "পিস", 168, 180, 175, 30, 120),
    dal: await product("মসুর ডাল (মোটা)", "P-005", "8941100300012", C.dal, B.local, "কেজি", 105, 120, 115, 50, 300),
    sugar: await product("চিনি", "P-006", "8941100400019", C.sugar, B.fresh, "কেজি", 125, 135, 130, 60, 200),
    salt: await product("ফ্রেশ আয়োডিনযুক্ত লবণ", "P-007", "8941100400026", C.sugar, B.fresh, "প্যাকেট", 38, 42, 40, 40, 150),
    atta: await product("প্রাণ আটা ২ কেজি", "P-008", "8941100500016", C.flour, B.pran, "প্যাকেট", 118, 130, 125, 25, 80),
    tea: await product("ইস্পাহানি মির্জাপুর চা ৪০০ গ্রাম", "P-009", "8941100600013", C.bev, B.ispahani, "প্যাকেট", 205, 225, 215, 20, 50),
    soap: await product("লাক্স সাবান ১০০ গ্রাম", "P-010", "8941100700010", C.care, B.lux, "পিস", 52, 60, 56, 50, 200),
    napa: await product("নাপা প্যারাসিটামল ৫০০ মি.গ্রা. (পাতা)", "P-011", "8941100800017", C.med, B.square, "পিস", 9, 12, 10.5, 50, 0, true),
  };

  // parties (credit terms make dues age realistically)
  const party = (name: string, mobile: string, address: string, openingBalance: number, creditLimit: number, creditDays: number) => ({ name, mobile, email: null, address, notes: null, openingBalance, creditLimit, creditDays });
  const cu = {
    rahim: await saveParty(ctx, "CUSTOMER", party("রহিম জেনারেল স্টোর", "01711-000001", "মিরপুর-১০, ঢাকা", 12_500, 1_50_000, 15)),
    karim: await saveParty(ctx, "CUSTOMER", party("করিম ট্রেডার্স", "01811-000002", "চকবাজার, চট্টগ্রাম", 0, 2_00_000, 30)),
    salma: await saveParty(ctx, "CUSTOMER", party("সালমা ভ্যারাইটিজ", "01911-000003", "নারায়ণগঞ্জ সদর", 0, 40_000, 7)),
    hotel: await saveParty(ctx, "CUSTOMER", party("হোটেল আল-মদিনা", "01611-000004", "যাত্রাবাড়ী, ঢাকা", 8_000, 80_000, 10)),
    mudi: await saveParty(ctx, "CUSTOMER", party("বিসমিল্লাহ মুদি দোকান", "01511-000005", "কেরানীগঞ্জ", 0, 25_000, 7)),
  };
  const su = {
    meghna: await saveParty(ctx, "SUPPLIER", party("মেঘনা গ্রুপ ডিস্ট্রিবিউশন", "01700-111111", "কারওয়ান বাজার, ঢাকা", 35_000, 0, 30)),
    city: await saveParty(ctx, "SUPPLIER", party("সিটি গ্রুপ (তীর) ডিলার", "01700-222222", "মৌলভীবাজার, ঢাকা", 0, 0, 15)),
    pran: await saveParty(ctx, "SUPPLIER", party("প্রাণ-আরএফএল ডিস্ট্রিবিউটর", "01700-333333", "বাড্ডা, ঢাকা", 0, 0, 21)),
    pharma: await saveParty(ctx, "SUPPLIER", party("স্কয়ার ফার্মা ডিপো", "01700-444444", "তেজগাঁও, ঢাকা", 0, 0, 30)),
  };

  type L = { productId: string; quantity: number; rate: number; unitId?: string; batchNo?: string; expiryDate?: Date; mfgDate?: Date };
  const trade = (type: "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN", days: number, partyId: string | null, items: L[], payments: { accountId: string; amount: number; reference?: string }[] = [], opts: { discount?: number; returnOfId?: string; reference?: string } = {}) =>
    saveTradeVoucher(ctx, type, {
      date: daysAgo(days), reference: opts.reference ?? null, narration: null, partyAccountId: partyId, warehouseId, returnOfId: opts.returnOfId ?? null, dueDate: null,
      discount: opts.discount ?? 0, vatPercent: 0, payments: payments.map((p) => ({ ...p, reference: p.reference ?? null })),
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, rate: i.rate, unitId: i.unitId ?? null, discount: 0, batchNo: i.batchNo ?? null, expiryDate: i.expiryDate ?? null, mfgDate: i.mfgDate ?? null })),
    });
  const BOSTA = units["বস্তা (৫০ কেজি)"];

  // purchases
  await trade("PURCHASE", 98, su.meghna.accountId, [{ productId: P.miniket, unitId: BOSTA, quantity: 40, rate: 3_050 }, { productId: P.dal, quantity: 400, rate: 104 }, { productId: P.sugar, quantity: 300, rate: 124 }], [{ accountId: BANK, amount: 1_00_000, reference: "CHQ-445501" }], { reference: "MG-INV-8812" });
  await trade("PURCHASE", 92, su.city.accountId, [{ productId: P.oil5, quantity: 80, rate: 815 }, { productId: P.oil1, quantity: 200, rate: 166 }], [{ accountId: BANK, amount: 50_000 }]);
  await trade("PURCHASE", 85, su.pran.accountId, [{ productId: P.atta, quantity: 150, rate: 117 }, { productId: P.tea, quantity: 80, rate: 203 }, { productId: P.salt, quantity: 200, rate: 37 }, { productId: P.soap, quantity: 300, rate: 51 }], [{ accountId: acc.CASH, amount: 25_000 }]);
  await trade("PURCHASE", 80, su.pharma.accountId, [
    { productId: P.napa, quantity: 500, rate: 9, batchNo: "NP-2408A", expiryDate: daysAgo(-20), mfgDate: daysAgo(700) },
    { productId: P.napa, quantity: 800, rate: 9.2, batchNo: "NP-2502C", expiryDate: daysAgo(-400), mfgDate: daysAgo(320) },
    // lots that show every expiry state on the dashboard: already expired, and expiring within a week
    { productId: P.napa, quantity: 60, rate: 8.5, batchNo: "NP-2405X", expiryDate: daysAgo(5), mfgDate: daysAgo(735) },
    { productId: P.napa, quantity: 40, rate: 8.8, batchNo: "NP-2409B", expiryDate: daysAgo(-6), mfgDate: daysAgo(720) },
  ], [{ accountId: BKASH, amount: 5_000, reference: "TrxID 9F3K2L" }]);
  // FEFO: no batch given → the earliest unexpired lot (NP-2409B) is used; the expired NP-2405X is skipped
  await trade("SALES", 2, null, [{ productId: P.napa, quantity: 15, rate: 12 }], [{ accountId: acc.CASH, amount: 180 }]);
  const latePurchase = await trade("PURCHASE", 45, su.meghna.accountId, [{ productId: P.miniket, unitId: BOSTA, quantity: 30, rate: 3_150 }, { productId: P.najir, quantity: 500, rate: 73 }], [{ accountId: BANK, amount: 60_000 }]);
  await trade("PURCHASE", 20, su.city.accountId, [{ productId: P.oil5, quantity: 50, rate: 830 }], []);

  // sales — credit customers, partial & split payments
  const s1 = await trade("SALES", 90, cu.rahim.accountId, [{ productId: P.miniket, unitId: BOSTA, quantity: 6, rate: 3_400 }, { productId: P.oil5, quantity: 10, rate: 860 }, { productId: P.sugar, quantity: 50, rate: 132 }], [{ accountId: acc.CASH, amount: 20_000 }]);
  await trade("SALES", 82, cu.karim.accountId, [{ productId: P.dal, quantity: 150, rate: 115 }, { productId: P.sugar, quantity: 100, rate: 130 }, { productId: P.oil1, quantity: 60, rate: 175 }], [{ accountId: BANK, amount: 15_000, reference: "NPSB 778812" }]);
  await trade("SALES", 75, cu.hotel.accountId, [{ productId: P.miniket, quantity: 120, rate: 69 }, { productId: P.oil5, quantity: 8, rate: 865 }], [{ accountId: BKASH, amount: 4_000, reference: "TrxID 7HJ21Q" }]);
  await trade("SALES", 70, cu.salma.accountId, [{ productId: P.soap, quantity: 60, rate: 58 }, { productId: P.tea, quantity: 20, rate: 220 }, { productId: P.salt, quantity: 40, rate: 41 }], [{ accountId: acc.CASH, amount: 3_000 }]);
  await trade("SALES", 60, cu.mudi.accountId, [{ productId: P.atta, quantity: 40, rate: 128 }, { productId: P.oil1, quantity: 30, rate: 178 }], []);
  await trade("SALES", 40, cu.hotel.accountId, [{ productId: P.najir, quantity: 150, rate: 82 }, { productId: P.oil5, quantity: 6, rate: 865 }], [{ accountId: BKASH, amount: 6_000, reference: "TrxID 5PX81M" }]);
  const s2 = await trade("SALES", 25, cu.karim.accountId, [{ productId: P.miniket, unitId: BOSTA, quantity: 10, rate: 3_450 }, { productId: P.dal, quantity: 80, rate: 116 }], [{ accountId: BANK, amount: 20_000 }, { accountId: BKASH, amount: 5_000, reference: "TrxID 2LQ09D" }]);
  await trade("SALES", 12, cu.rahim.accountId, [{ productId: P.oil5, quantity: 12, rate: 870 }, { productId: P.atta, quantity: 30, rate: 128 }], [{ accountId: acc.CASH, amount: 10_000 }]);
  await trade("SALES", 3, cu.salma.accountId, [{ productId: P.tea, quantity: 10, rate: 222 }, { productId: P.soap, quantity: 40, rate: 58 }], []);
  // walk-in POS sales (cash + bKash), recent days
  for (const [days, items, pays] of [
    [9, [{ productId: P.miniket, quantity: 25, rate: 70 }, { productId: P.oil1, quantity: 2, rate: 180 }], [{ accountId: acc.CASH, amount: 2_110 }]],
    [6, [{ productId: P.sugar, quantity: 5, rate: 135 }, { productId: P.napa, quantity: 20, rate: 12, batchNo: "NP-2408A" }], [{ accountId: acc.CASH, amount: 500 }, { accountId: BKASH, amount: 415, reference: "TrxID 1AB2CD" }]],
    [2, [{ productId: P.dal, quantity: 10, rate: 120 }, { productId: P.salt, quantity: 4, rate: 42 }, { productId: P.soap, quantity: 6, rate: 60 }], [{ accountId: acc.CASH, amount: 1_728 }]],
    [1, [{ productId: P.najir, quantity: 20, rate: 82 }, { productId: P.tea, quantity: 2, rate: 225 }], [{ accountId: BKASH, amount: 2_090, reference: "TrxID 9ZX3VB" }]],
    [0, [{ productId: P.miniket, quantity: 10, rate: 70 }, { productId: P.oil5, quantity: 1, rate: 870 }, { productId: P.napa, quantity: 10, rate: 12, batchNo: "NP-2502C" }], [{ accountId: acc.CASH, amount: 1_690 }]],
    [0, [{ productId: P.sugar, quantity: 3, rate: 135 }, { productId: P.atta, quantity: 2, rate: 130 }], [{ accountId: acc.CASH, amount: 300 }, { accountId: BKASH, amount: 365 }]],
  ] as [number, L[], { accountId: string; amount: number; reference?: string }[]][]) {
    await trade("SALES", days, null, items, pays);
  }
  // credit sale today
  await trade("SALES", 0, cu.mudi.accountId, [{ productId: P.miniket, unitId: BOSTA, quantity: 2, rate: 3_450 }, { productId: P.salt, quantity: 20, rate: 41 }], [{ accountId: acc.CASH, amount: 2_000 }]);

  // returns against invoices
  await trade("SALES_RETURN", 85, cu.rahim.accountId, [{ productId: P.sugar, quantity: 5, rate: 132 }], [], { returnOfId: s1.id, reference: s1.voucherNo });
  await trade("SALES_RETURN", 22, cu.karim.accountId, [{ productId: P.dal, quantity: 10, rate: 116 }], [{ accountId: acc.CASH, amount: 1_160 }], { returnOfId: s2.id, reference: s2.voucherNo });
  await trade("PURCHASE_RETURN", 40, su.meghna.accountId, [{ productId: P.najir, quantity: 25, rate: 73 }], [], { returnOfId: latePurchase.id, reference: latePurchase.voucherNo });

  // collections & supplier payments
  const cash = (type: "RECEIPT" | "PAYMENT", days: number, cashAccountId: string, lines: { accountId: string; amount: number }[], narration: string, reference: string | null = null) =>
    saveCashVoucher(ctx, type, { date: daysAgo(days), reference, narration, cashAccountId, lines: lines.map((l) => ({ ...l, narration: null })) });
  await cash("RECEIPT", 65, acc.CASH, [{ accountId: cu.rahim.accountId, amount: 25_000 }], "রহিম জেনারেল স্টোর থেকে বকেয়া আদায়");
  await cash("RECEIPT", 50, BANK, [{ accountId: cu.karim.accountId, amount: 30_000 }], "করিম ট্রেডার্স — ব্যাংক ট্রান্সফার", "BEFTN 5512");
  await cash("RECEIPT", 18, BKASH, [{ accountId: cu.salma.accountId, amount: 2_500 }], "সালমা ভ্যারাইটিজ — বিকাশ", "TrxID 4KL90P");
  await cash("RECEIPT", 5, acc.CASH, [{ accountId: cu.hotel.accountId, amount: 10_000 }, { accountId: cu.rahim.accountId, amount: 15_000 }], "বকেয়া আদায় (দুই কাস্টমার)");
  await cash("PAYMENT", 70, BANK, [{ accountId: su.meghna.accountId, amount: 60_000 }], "মেঘনা — দেনা পরিশোধ", "CHQ-445517");
  await cash("PAYMENT", 35, BANK, [{ accountId: su.city.accountId, amount: 40_000 }], "সিটি গ্রুপ — দেনা পরিশোধ");
  await cash("PAYMENT", 15, acc.CASH, [{ accountId: su.pran.accountId, amount: 20_000 }], "প্রাণ ডিস্ট্রিবিউটর — দেনা পরিশোধ");

  // monthly expenses
  for (const d of [88, 58, 28]) {
    await cash("PAYMENT", d, acc.CASH, [{ accountId: key("RENT"), amount: 18_000 }, { accountId: key("UTILITY"), amount: 3_200 }], "মাসিক দোকান ভাড়া ও বিদ্যুৎ বিল");
    await cash("PAYMENT", d - 1, BANK, [{ accountId: key("SALARY"), amount: 36_000 }], "কর্মচারীদের মাসিক বেতন (৩ জন)");
  }
  await cash("PAYMENT", 7, acc.CASH, [{ accountId: key("TRANSPORT"), amount: 2_850 }, { accountId: key("ENTERTAINMENT"), amount: 640 }], "ভ্যান ভাড়া ও অতিথি আপ্যায়ন");
  await cash("PAYMENT", 0, acc.CASH, [{ accountId: key("OFFICE"), amount: 450 }], "খাতা-কলম ও প্যাকেজিং ব্যাগ");
  await cash("RECEIPT", 30, acc.CASH, [{ accountId: key("COMMISSION_INCOME"), amount: 3_500 }], "কোম্পানি থেকে বিক্রয় কমিশন");

  // contra & owner drawing
  await saveJournalVoucher(ctx, {
    date: daysAgo(55), reference: "DEP-0921", narration: "নগদ ব্যাংকে জমা",
    lines: [{ accountId: BANK, debit: 50_000, credit: 0, narration: null }, { accountId: acc.CASH, debit: 0, credit: 50_000, narration: null }],
  });
  await saveJournalVoucher(ctx, {
    date: daysAgo(14), reference: null, narration: "মালিকের ব্যক্তিগত উত্তোলন",
    lines: [{ accountId: key("DRAWINGS"), debit: 10_000, credit: 0, narration: null }, { accountId: acc.CASH, debit: 0, credit: 10_000, narration: null }],
  });
  // stock adjustment (damaged goods)
  await saveStockJournal(ctx, { date: daysAgo(10), reference: null, narration: "ইঁদুরে কাটা — নষ্ট চাল ও আটা", lines: [{ productId: P.miniket, warehouseId, direction: -1, quantity: 15, rate: undefined, batchNo: null, expiryDate: null, mfgDate: null }, { productId: P.atta, warehouseId, direction: -1, quantity: 3, rate: undefined, batchNo: null, expiryDate: null, mfgDate: null }] });
}

main()
  .catch((e) => {
    console.error("Seed failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

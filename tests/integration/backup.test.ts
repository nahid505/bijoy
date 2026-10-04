import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import { setAccountOpening, systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty, saveProduct } from "@/server/services/master";
import { saveTradeVoucher } from "@/server/services/voucher";
import { exportBusiness, restoreBackup, validateBackup } from "@/server/services/backup";
import { trialBalance } from "@/server/services/report";
import { balancesByKind } from "@/server/services/ledger";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

run("backup → validate → restore", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { name: "Backup", email: `b${Date.now()}@test.local`, passwordHash: "x" } });
    const b = await prisma.$transaction((tx) => createBusiness(tx, { name: "ব্যাকআপ ব্যবসা", ownerUserId: user.id }));
    ctx = { businessId: b.id, userId: user.id };
    const acc = await prisma.$transaction((tx) => systemAccounts(tx, ctx.businessId));
    await prisma.$transaction((tx) => setAccountOpening(tx, ctx, acc.CASH, 5_000));
    const kg = (await prisma.unit.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "কেজি" } })).id;
    const p = await saveProduct(ctx, { name: "চাল", code: "R", barcode: null, categoryId: null, brandId: null, unitId: kg, purchasePrice: 50, salePrice: 60, wholesalePrice: 0, minStock: 0, openingStock: 20, openingRate: 50, trackBatch: false });
    const c = await saveParty(ctx, "CUSTOMER", { name: "রহিম", mobile: null, email: null, address: null, notes: null, openingBalance: 300, creditLimit: 0, creditDays: 7 });
    const s = await saveTradeVoucher(ctx, "SALES", {
      date: D("2026-08-02"), reference: null, narration: null, partyAccountId: c.accountId, warehouseId: null, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0,
      payments: [{ accountId: acc.CASH, amount: 100, reference: null }], items: [{ productId: p, quantity: 5, rate: 60, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }],
    });
    await saveTradeVoucher(ctx, "SALES_RETURN", {
      date: D("2026-08-03"), reference: null, narration: null, partyAccountId: c.accountId, warehouseId: null, returnOfId: s.id, dueDate: null, discount: 0, vatPercent: 0,
      payments: [], items: [{ productId: p, quantity: 1, rate: 60, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }],
    });
    // batch-tracked product: two lots, one FEFO sale
    const med = await saveProduct(ctx, { name: "ওষুধ", code: "M", barcode: null, categoryId: null, brandId: null, unitId: kg, purchasePrice: 10, salePrice: 15, wholesalePrice: 0, minStock: 0, openingStock: 0, openingRate: 0, trackBatch: true });
    const sup = await saveParty(ctx, "SUPPLIER", { name: "ডিপো", mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });
    const lot = (batchNo: string, exp: string, q: number) => ({ productId: med, quantity: q, rate: 10, unitId: null, discount: 0, batchNo, expiryDate: D(exp), mfgDate: D("2026-01-01") });
    await saveTradeVoucher(ctx, "PURCHASE", { date: D("2026-08-01"), reference: null, narration: null, partyAccountId: sup.accountId, warehouseId: null, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [], items: [lot("L1", "2026-12-01", 5), lot("L2", "2027-06-01", 10)] });
    await saveTradeVoucher(ctx, "SALES", {
      date: D("2026-08-05"), reference: null, narration: null, partyAccountId: null, warehouseId: null, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0,
      payments: [{ accountId: acc.CASH, amount: 105, reference: null }], items: [{ productId: med, quantity: 7, rate: 15, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }],
    });
  });

  const batchesOf = (businessId: string) =>
    prisma.productBatch.findMany({ where: { businessId }, orderBy: { batchNo: "asc" } }).then((rows) =>
      rows.map((b) => ({ batchNo: b.batchNo, qty: Number(b.quantity), exp: b.expiryDate?.toISOString().slice(0, 10), mfg: b.mfgDate?.toISOString().slice(0, 10) ?? null })),
    );

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("exports a valid, checksummed backup", async () => {
    const file = await exportBusiness(ctx.businessId);
    const report = validateBackup(JSON.parse(JSON.stringify(file)));
    expect(report.ok).toBe(true);
    expect(report.totals!.debit).toBe(report.totals!.credit);
  });

  it("detects tampering and unbalanced vouchers", async () => {
    const file = JSON.parse(JSON.stringify(await exportBusiness(ctx.businessId)));
    file.data.journalEntries[0].debit = String(Number(file.data.journalEntries[0].debit) + 1);
    const r = validateBackup(file);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/চেকসাম/);
    expect(r.errors.join(" ")).toMatch(/ডেবিট ≠ ক্রেডিট/);
    expect(validateBackup({ format: "other" }).ok).toBe(false);
  });

  it("restores into a NEW business with identical books", async () => {
    const file = JSON.parse(JSON.stringify(await exportBusiness(ctx.businessId)));
    const { businessId } = await restoreBackup(file, ctx.userId);
    expect(businessId).not.toBe(ctx.businessId);
    const [a, b] = await Promise.all([trialBalance(ctx.businessId, {}), trialBalance(businessId, {})]);
    expect(b.balanced).toBe(true);
    expect(b.totals).toEqual(a.totals);
    const [ca, cb] = await Promise.all([balancesByKind(ctx.businessId, ["CUSTOMER"]), balancesByKind(businessId, ["CUSTOMER"])]);
    expect(cb.map((x) => x.balance)).toEqual(ca.map((x) => x.balance));
    const [pa, pb] = await Promise.all([prisma.product.findFirstOrThrow({ where: { businessId: ctx.businessId, code: "R" } }), prisma.product.findFirstOrThrow({ where: { businessId, code: "R" } })]);
    expect(Number(pb.stock)).toBe(Number(pa.stock));
    expect(Number(pb.avgCost)).toBe(Number(pa.avgCost));
    // the return still points at its (remapped) invoice
    const ret = await prisma.voucher.findFirstOrThrow({ where: { businessId, type: "SALES_RETURN" }, include: { returnOf: true } });
    expect(ret.returnOf?.businessId).toBe(businessId);
    // batches (lot data, FEFO quantities) survive the round trip and stay linked to movements
    expect(await batchesOf(businessId)).toEqual(await batchesOf(ctx.businessId));
    expect(await batchesOf(businessId)).toEqual([{ batchNo: "L1", qty: 0, exp: "2026-12-01", mfg: "2026-01-01" }, { batchNo: "L2", qty: 8, exp: "2027-06-01", mfg: "2026-01-01" }]);
    expect(await prisma.stockMovement.count({ where: { businessId, batchNo: { not: null }, batchId: null } })).toBe(0);
  });

  it("carries customer groups and SMS templates; restored SMS settings are off and hold no API key", async () => {
    await prisma.customer.updateMany({ where: { businessId: ctx.businessId }, data: { groupName: "পাইকারি" } });
    await prisma.smsTemplate.upsert({ where: { businessId_event: { businessId: ctx.businessId, event: "SALE_INVOICE" } }, create: { businessId: ctx.businessId, event: "SALE_INVOICE", body: "কাস্টম {invoice_no}" }, update: { body: "কাস্টম {invoice_no}" } });
    await prisma.smsSettings.upsert({ where: { businessId: ctx.businessId }, create: { businessId: ctx.businessId, enabled: true, provider: "bulksmsbd", apiKeyEnc: "v1:secret", apiKeyHint: "••••cret", senderId: "SHOP" }, update: {} });
    const file = JSON.parse(JSON.stringify(await exportBusiness(ctx.businessId)));
    expect(JSON.stringify(file)).not.toContain("v1:secret");
    const { businessId } = await restoreBackup(file, ctx.userId);
    expect(await prisma.customer.count({ where: { businessId, groupName: "পাইকারি" } })).toBeGreaterThan(0);
    expect((await prisma.smsTemplate.findUniqueOrThrow({ where: { businessId_event: { businessId, event: "SALE_INVOICE" } } })).body).toBe("কাস্টম {invoice_no}");
    const ss = await prisma.smsSettings.findUniqueOrThrow({ where: { businessId } });
    expect(ss).toMatchObject({ enabled: false, provider: "bulksmsbd", senderId: "SHOP", apiKeyEnc: null, apiKeyHint: null });
  });

  it("still restores an older v2 backup (batches rebuilt from batch numbers)", async () => {
    const file = JSON.parse(JSON.stringify(await exportBusiness(ctx.businessId)));
    delete file.data.productBatches;
    delete file.data.notifications;
    for (const t of ["stockMovements", "voucherItems"]) for (const r of file.data[t]) delete r.batchId;
    file.version = 2;
    file.checksum = createHash("sha256").update(JSON.stringify(file.data)).digest("hex");
    expect(validateBackup(JSON.parse(JSON.stringify(file))).ok).toBe(true);
    const { businessId } = await restoreBackup(file, ctx.userId);
    expect((await batchesOf(businessId)).map((b) => [b.batchNo, b.qty, b.exp])).toEqual([["L1", 0, "2026-12-01"], ["L2", 8, "2027-06-01"]]);
    expect((await trialBalance(businessId, {})).balanced).toBe(true);
  });
});

// User-specific customer / supplier restriction ("শুধু নির্ধারিত কাস্টমার / সরবরাহকারী").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveParty } from "@/server/services/master";
import { saveCashVoucher, saveTradeVoucher } from "@/server/services/voucher";
import {
  assertPartiesAllowed, assignedPartiesOf, canOpenLedger, canSeeVoucher, loadPartyScope, partyListWhere, restrictionsOf, saveAssignments, voucherScopeWhere, type PartyScope,
} from "@/server/party-scope";
import { findReport, reportOpenFor } from "@/server/reports/registry";
import { searchParties } from "@/server/lookup";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const party = (name: string) => ({ name, mobile: null, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });

run("party restriction (শুধু নির্ধারিত কাস্টমার / সরবরাহকারী)", () => {
  let owner: Ctx;
  let rep: { id: string };
  let acc: Awaited<ReturnType<typeof systemAccounts>>;
  let warehouseId: string;
  let rice: string;
  let rahim: { id: string; accountId: string };
  let karim: { id: string; accountId: string };
  let aci: { id: string; accountId: string };
  let bsrm: { id: string; accountId: string };
  const v: Record<string, string> = {};
  // a restricted request context (what getContext builds)
  let scope: PartyScope;
  const ctxOf = () => ({
    partyScope: scope,
    user: { id: rep.id },
    business: { id: owner.businessId, currencySymbol: "৳", fiscalYearStartMonth: 7, businessType: null },
    permissions: ["reports:view"],
  });
  const sale = (partyAccountId: string | null, by: Ctx, paid = 0) =>
    saveTradeVoucher(by, "SALES", {
      date: D("2026-10-10"), reference: null, narration: null, partyAccountId, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0,
      payments: paid ? [{ accountId: acc.CASH, amount: paid, reference: null }] : [],
      items: [{ productId: rice, quantity: 1, rate: 1_000, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }],
    });

  beforeAll(async () => {
    const u = await prisma.user.create({ data: { name: "Owner", email: `ps-o${Date.now()}@test.local`, passwordHash: "x" } });
    const business = await prisma.$transaction((tx) => createBusiness(tx, { name: "পার্টি স্কোপ", ownerUserId: u.id }));
    owner = { businessId: business.id, userId: u.id };
    rep = await prisma.user.create({ data: { name: "Rep", email: `ps-r${Date.now()}@test.local`, passwordHash: "x" } });
    const role = await prisma.role.create({ data: { businessId: business.id, name: "বিক্রয় প্রতিনিধি", permissions: ["customers:view", "sales:view", "sales:create", "reports:view", "customers:assigned_only"] } });
    await prisma.membership.create({ data: { businessId: business.id, userId: rep.id, roleId: role.id } });
    acc = await prisma.$transaction((tx) => systemAccounts(tx, owner.businessId));
    warehouseId = (await prisma.warehouse.findFirstOrThrow({ where: { businessId: owner.businessId } })).id;
    const pcs = await prisma.unit.findFirstOrThrow({ where: { businessId: owner.businessId, name: "পিস" } });
    rice = (await prisma.product.create({ data: { businessId: owner.businessId, name: "চাল", unitId: pcs.id, salePrice: 1_000 } })).id;
    rahim = await saveParty(owner, "CUSTOMER", party("রহিম"));
    karim = await saveParty(owner, "CUSTOMER", party("করিম"));
    aci = await saveParty(owner, "SUPPLIER", party("এসিআই"));
    bsrm = await saveParty(owner, "SUPPLIER", party("বিএসআরএম"));
    await saveTradeVoucher(owner, "PURCHASE", {
      date: D("2026-10-09"), reference: null, narration: null, partyAccountId: aci.accountId, warehouseId, returnOfId: null, dueDate: null, discount: 0, vatPercent: 0, payments: [],
      items: [{ productId: rice, quantity: 100, rate: 800, unitId: null, discount: 0, batchNo: null, expiryDate: null, mfgDate: null }],
    });
    v.rahim = (await sale(rahim.accountId, owner)).id;
    v.karim = (await sale(karim.accountId, owner)).id;
    v.walkInOwner = (await sale(null, owner, 1_000)).id;
    v.walkInRep = (await sale(null, { businessId: owner.businessId, userId: rep.id }, 1_000)).id;
    // one receipt from both customers (no single party on the voucher)
    v.receiptBoth = (await saveCashVoucher(owner, "RECEIPT", { date: D("2026-10-11"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: rahim.accountId, amount: 100, narration: null }, { accountId: karim.accountId, amount: 100, narration: null }] })).id;
    v.receiptRahim = (await saveCashVoucher(owner, "RECEIPT", { date: D("2026-10-11"), reference: null, narration: null, cashAccountId: acc.CASH, lines: [{ accountId: rahim.accountId, amount: 200, narration: null }] })).id;
    // assignment: Rahim (and a foreign id that must be ignored)
    expect(await saveAssignments(owner.businessId, rep.id, [rahim.id, "foreign-id"], [aci.id])).toEqual({ customers: 1, suppliers: 1, accounts: 0 });
    scope = await loadPartyScope(owner.businessId, rep.id, restrictionsOf(role.permissions, false));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("restriction keys count only when the role names them; Owner / '*' are never restricted", () => {
    expect(restrictionsOf(["customers:view", "customers:assigned_only"], false)).toEqual({ customers: true, suppliers: false, accounts: false });
    expect(restrictionsOf(["*"], false)).toEqual({ customers: false, suppliers: false, accounts: false });
    expect(restrictionsOf(["customers:assigned_only"], true)).toEqual({ customers: false, suppliers: false, accounts: false });
    // only customers are restricted here: suppliers stay open (the supplier assignment is kept, not applied)
    expect(scope).toEqual({ customers: [rahim.accountId], suppliers: null, accounts: null });
  });

  it("customer list and picker: only the assigned customers", async () => {
    const rows = await prisma.customer.findMany({ where: { businessId: owner.businessId, ...partyListWhere(ctxOf(), "CUSTOMER") } });
    expect(rows.map((r) => r.name)).toEqual(["রহিম"]);
    expect((await prisma.supplier.count({ where: { businessId: owner.businessId, ...partyListWhere(ctxOf(), "SUPPLIER") } }))).toBe(2);
    expect((await searchParties(owner.businessId, "CUSTOMER", "", { allowed: scope.customers })).map((p) => p.name)).toEqual(["রহিম"]);
    expect(await searchParties(owner.businessId, "CUSTOMER", "", { accountIds: [karim.accountId], allowed: scope.customers })).toEqual([]);
  });

  it("vouchers: own customers, own walk-in sales; never another customer's (also inside a multi-party receipt)", async () => {
    const seen = await prisma.voucher.findMany({ where: { businessId: owner.businessId, ...voucherScopeWhere(ctxOf()), type: { in: ["SALES", "RECEIPT"] } }, select: { id: true } });
    const ids = new Set(seen.map((x) => x.id));
    expect([v.rahim, v.walkInRep, v.receiptRahim].every((x) => ids.has(x))).toBe(true);
    expect([v.karim, v.walkInOwner, v.receiptBoth].some((x) => ids.has(x))).toBe(false);
    expect(await canSeeVoucher(ctxOf(), v.karim)).toBe(false);
    expect(await canSeeVoucher(ctxOf(), v.rahim)).toBe(true);
    // purchases are not restricted for this role
    expect(await prisma.voucher.count({ where: { businessId: owner.businessId, ...voucherScopeWhere(ctxOf()), type: "PURCHASE" } })).toBe(1);
  });

  it("saving: a voucher for another customer is refused; own customer / non-party accounts pass", async () => {
    await expect(assertPartiesAllowed(ctxOf(), [karim.accountId])).rejects.toThrow(/নির্ধারিত নয়/);
    await expect(assertPartiesAllowed(ctxOf(), [rahim.accountId, acc.CASH, null])).resolves.toBeUndefined();
    await expect(assertPartiesAllowed(ctxOf(), [bsrm.accountId])).resolves.toBeUndefined(); // suppliers open
  });

  it("ledgers: own customer's ledger only (not sales / cash ledgers listing everyone)", async () => {
    expect(await canOpenLedger(ctxOf(), rahim.accountId)).toBe(true);
    expect(await canOpenLedger(ctxOf(), karim.accountId)).toBe(false);
    expect(await canOpenLedger(ctxOf(), acc.CASH)).toBe(false);
    expect(await canOpenLedger(ctxOf(), aci.accountId)).toBe(true);
    const r = await findReport("ledger")!.run(ctxOf() as never, { accountId: karim.accountId });
    expect(r.rows).toHaveLength(0);
    expect(r.emptyMessage).toContain("নির্ধারিত নয়");
  });

  it("reports: filtered to the assigned customers; business-wide books are refused", async () => {
    const c = ctxOf() as never;
    const names = (rows: { kind?: string; cells: Record<string, unknown> }[], key: string) => rows.filter((r) => !r.kind).map((r) => r.cells[key]);
    const customers = await findReport("customers")!.run(c, { from: "2026-07-01", to: "2026-10-31" });
    expect(names(customers.rows, "name")).toEqual(["রহিম"]);
    const sales = await findReport("sales")!.run(c, { from: "2026-07-01", to: "2026-10-31" });
    expect(sales.rows.filter((r) => !r.kind).length).toBe(2); // Rahim + own walk-in
    const dues = await findReport("customer-dues")!.run(c, { asOf: "2026-10-31" });
    expect(names(dues.rows, "name").length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(dues.rows)).not.toContain("করিম");
    const coll = await findReport("collection")!.run(c, { from: "2026-07-01", to: "2026-10-31" });
    expect(JSON.stringify(coll.rows)).not.toContain("করিম");
    for (const slug of ["trial-balance", "profit-loss", "balance-sheet", "day-book", "cash-book", "daily-cash", "daily-summary"]) expect(reportOpenFor(ctxOf(), slug), slug).toBe(false);
    for (const slug of ["customers", "sales", "ledger", "customer-dues", "stock", "expiry"]) expect(reportOpenFor(ctxOf(), slug), slug).toBe(true);
    expect(reportOpenFor({ partyScope: { customers: null, suppliers: null } }, "trial-balance")).toBe(true);
  });

  it("the user form loads the assignment (customers, dealers and suppliers apart)", async () => {
    const dealer = await saveParty(owner, "CUSTOMER", party("ডিলার ১"), undefined, { dealer: true });
    await saveAssignments(owner.businessId, rep.id, [rahim.id, dealer.id], [aci.id]);
    const a = await assignedPartiesOf(owner.businessId, rep.id);
    expect(a.customers.map((x) => x.name)).toEqual(["রহিম"]);
    expect(a.dealers.map((x) => x.name)).toEqual(["ডিলার ১"]);
    expect(a.suppliers.map((x) => x.name)).toEqual(["এসিআই"]);
    await saveAssignments(owner.businessId, rep.id, [rahim.id], [aci.id]);
  });

  it("a customer deleted from the business drops out of the assignment (cascade)", async () => {
    const temp = await saveParty(owner, "CUSTOMER", party("অস্থায়ী"));
    await saveAssignments(owner.businessId, rep.id, [rahim.id, temp.id], []);
    expect(await prisma.userCustomer.count({ where: { userId: rep.id } })).toBe(2);
    await prisma.customer.delete({ where: { id: temp.id } });
    expect(await prisma.userCustomer.count({ where: { userId: rep.id } })).toBe(1);
  });
});

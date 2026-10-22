// Data-integrity audit (read-only). Usage: npx tsx scripts/audit-integrity.ts   (uses DATABASE_URL)
//
// Checks what the schema does not enforce by itself and what the books rely on:
//   • denormalised tenant / audit columns (businessId copies, createdById …) point at real rows of the same business
//   • every voucher balances; GENERAL and DEPOT books each balance per business
//   • JournalEntry.book = its voucher's book; DEPOT vouchers only in depot businesses; challans in the DEPOT book
//   • depot dealers never in GENERAL vouchers; general customers never in DEPOT vouchers
//   • depot products move only in DEPOT vouchers, general products only in GENERAL ones
//   • product stock = Σ stock movements; free quantities never negative
//   • user ↔ customer / supplier assignments stay inside one business
// Prints every problem found and exits 1 if there is any (0 = clean).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const problems: string[] = [];
const fail = (area: string, detail: string) => problems.push(`[${area}] ${detail}`);
const n = (v: unknown) => Number(v ?? 0);
const cents = (v: number) => Math.round(v * 100);

async function tenantCopies() {
  // child.businessId must equal the parent's business (the parent relation is enforced; the copy is not)
  const checks: [string, () => Promise<{ id: string; businessId: string; parentBusiness: string | null }[]>][] = [
    ["SalaryRevision → Employee", async () => (await prisma.salaryRevision.findMany({ select: { id: true, businessId: true, employee: { select: { businessId: true } } } })).map((x) => ({ id: x.id, businessId: x.businessId, parentBusiness: x.employee.businessId }))],
    ["Attendance → Employee", async () => (await prisma.attendance.findMany({ select: { id: true, businessId: true, employee: { select: { businessId: true } } } })).map((x) => ({ id: x.id, businessId: x.businessId, parentBusiness: x.employee.businessId }))],
    ["Payslip → PayrollRun", async () => (await prisma.payslip.findMany({ select: { id: true, businessId: true, run: { select: { businessId: true } } } })).map((x) => ({ id: x.id, businessId: x.businessId, parentBusiness: x.run.businessId }))],
    ["EmployeeAdvance → Employee", async () => (await prisma.employeeAdvance.findMany({ select: { id: true, businessId: true, employee: { select: { businessId: true } } } })).map((x) => ({ id: x.id, businessId: x.businessId, parentBusiness: x.employee.businessId }))],
    ["SalaryPayment → Employee", async () => (await prisma.salaryPayment.findMany({ select: { id: true, businessId: true, employee: { select: { businessId: true } } } })).map((x) => ({ id: x.id, businessId: x.businessId, parentBusiness: x.employee.businessId }))],
    ["SubscriptionEvent → Subscription", async () => (await prisma.subscriptionEvent.findMany({ select: { id: true, businessId: true, subscription: { select: { businessId: true } } } })).map((x) => ({ id: x.id, businessId: x.businessId, parentBusiness: x.subscription.businessId }))],
    ["SubscriptionPayment → Subscription", async () => (await prisma.subscriptionPayment.findMany({ select: { id: true, businessId: true, subscription: { select: { businessId: true } } } })).map((x) => ({ id: x.id, businessId: x.businessId, parentBusiness: x.subscription.businessId }))],
  ];
  for (const [name, load] of checks) for (const r of await load()) if (r.businessId !== r.parentBusiness) fail("tenant", `${name}: ${r.id} has businessId ${r.businessId}, parent belongs to ${r.parentBusiness}`);

  // audit columns: the user must exist
  const users = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
  const userRefs: [string, () => Promise<(string | null)[]>][] = [
    ["SalaryRevision.createdById", async () => (await prisma.salaryRevision.findMany({ select: { createdById: true } })).map((x) => x.createdById)],
    ["Attendance.updatedById", async () => (await prisma.attendance.findMany({ select: { updatedById: true } })).map((x) => x.updatedById)],
    ["PayrollRun.createdById / postedById", async () => (await prisma.payrollRun.findMany({ select: { createdById: true, postedById: true } })).flatMap((x) => [x.createdById, x.postedById])],
    ["EmployeeAdvance.createdById", async () => (await prisma.employeeAdvance.findMany({ select: { createdById: true } })).map((x) => x.createdById)],
    ["SalaryPayment.createdById", async () => (await prisma.salaryPayment.findMany({ select: { createdById: true } })).map((x) => x.createdById)],
    ["BusinessFeature.changedById / overrideById", async () => (await prisma.businessFeature.findMany({ select: { changedById: true, overrideById: true } })).flatMap((x) => [x.changedById, x.overrideById])],
    ["SubscriptionEvent.actorUserId", async () => (await prisma.subscriptionEvent.findMany({ select: { actorUserId: true } })).map((x) => x.actorUserId)],
    ["PaymentTransaction.initiatedById / verifiedById", async () => (await prisma.paymentTransaction.findMany({ select: { initiatedById: true, verifiedById: true } })).flatMap((x) => [x.initiatedById, x.verifiedById])],
  ];
  for (const [name, load] of userRefs) {
    const bad = (await load()).filter((id) => id && !users.has(id));
    if (bad.length) fail("audit-user", `${name}: ${bad.length} reference(s) to a missing user`);
  }
}

async function books() {
  const businesses = await prisma.business.findMany({ select: { id: true, name: true, businessType: true } });
  for (const b of businesses) {
    const vouchers = await prisma.voucher.findMany({
      where: { businessId: b.id },
      select: { id: true, voucherNo: true, type: true, book: true, depotDelivery: { select: { id: true } }, entries: { select: { debit: true, credit: true, book: true, account: { select: { systemKey: true, customer: { select: { isDepotDealer: true } } } } } } },
    });
    const total = { GENERAL: { dr: 0, cr: 0 }, DEPOT: { dr: 0, cr: 0 } };
    for (const v of vouchers) {
      const dr = v.entries.reduce((s, e) => s + n(e.debit), 0);
      const cr = v.entries.reduce((s, e) => s + n(e.credit), 0);
      if (cents(dr) !== cents(cr)) fail("balance", `${b.name}: ${v.voucherNo} debit ${dr} ≠ credit ${cr}`);
      total[v.book].dr += dr;
      total[v.book].cr += cr;
      if (v.entries.some((e) => e.book !== v.book)) fail("book", `${b.name}: ${v.voucherNo} has entries outside its ${v.book} book`);
      if (v.book === "DEPOT" && b.businessType !== "DEPOT") fail("book", `${b.name}: DEPOT voucher ${v.voucherNo} in a non-depot business`);
      if (v.depotDelivery && v.book !== "DEPOT") fail("book", `${b.name}: challan ${v.voucherNo} is in the GENERAL book`);
      if (v.type === "OPENING") continue;
      for (const e of v.entries) {
        const dealer = e.account.customer?.isDepotDealer;
        if (v.book === "GENERAL" && (dealer === true || e.account.systemKey?.startsWith("DEPOT_"))) fail("isolation", `${b.name}: GENERAL voucher ${v.voucherNo} posts to a depot dealer / depot ledger`);
        if (v.book === "DEPOT" && dealer === false) fail("isolation", `${b.name}: DEPOT voucher ${v.voucherNo} posts to a general customer`);
      }
    }
    for (const k of ["GENERAL", "DEPOT"] as const) if (cents(total[k].dr) !== cents(total[k].cr)) fail("balance", `${b.name}: ${k} book debit ${total[k].dr} ≠ credit ${total[k].cr}`);
  }
}

async function stock() {
  const moves = await prisma.stockMovement.groupBy({ by: ["productId"], _sum: { quantityIn: true, quantityOut: true } });
  const sum = new Map(moves.map((m) => [m.productId, n(m._sum.quantityIn) - n(m._sum.quantityOut)]));
  for (const p of await prisma.product.findMany({ select: { id: true, name: true, stock: true, businessId: true } }))
    if (Math.abs(n(p.stock) - (sum.get(p.id) ?? 0)) > 0.0005) fail("stock", `${p.name} (${p.businessId}): stock ${n(p.stock)} ≠ movements ${sum.get(p.id) ?? 0}`);
  // depot products move only in depot-book vouchers, general products only in general ones (opening stock aside)
  const mixed = await prisma.stockMovement.findMany({
    where: { voucher: { type: { not: "OPENING" } }, OR: [{ product: { isDepotProduct: true }, voucher: { book: "GENERAL" } }, { product: { isDepotProduct: false }, voucher: { book: "DEPOT" } }] },
    select: { product: { select: { name: true, isDepotProduct: true } }, voucher: { select: { voucherNo: true, book: true } } },
    take: 50,
  });
  for (const m of mixed) fail("product-book", `${m.voucher!.voucherNo} (${m.voucher!.book}) moves ${m.product.isDepotProduct ? "depot" : "general"} product "${m.product.name}"`);
  const negativeFree = await prisma.voucherItem.count({ where: { freeQuantity: { lt: 0 } } });
  if (negativeFree) fail("free", `${negativeFree} voucher line(s) with a negative free quantity`);
  // a line's stock movement = paid + free quantity (in base units)
  const items = await prisma.voucherItem.findMany({
    where: { freeQuantity: { gt: 0 } },
    select: { id: true, baseQuantity: true, freeQuantity: true, unitFactor: true, voucher: { select: { voucherNo: true } }, stockMovements: { select: { quantityIn: true, quantityOut: true } } },
  });
  for (const i of items) {
    const moved = i.stockMovements.reduce((s, m) => s + n(m.quantityIn) + n(m.quantityOut), 0);
    const expected = n(i.baseQuantity) + n(i.freeQuantity) * (n(i.unitFactor) || 1);
    if (i.stockMovements.length && Math.abs(moved - expected) > 0.0005) fail("free", `${i.voucher.voucherNo}: line moves ${moved}, expected paid + free = ${expected}`);
  }
}

async function assignments() {
  for (const a of await prisma.userCustomer.findMany({ select: { id: true, businessId: true, userId: true, customer: { select: { businessId: true } } } }))
    if (a.customer.businessId !== a.businessId) fail("scope", `UserCustomer ${a.id}: customer of another business`);
  for (const a of await prisma.userSupplier.findMany({ select: { id: true, businessId: true, supplier: { select: { businessId: true } } } }))
    if (a.supplier.businessId !== a.businessId) fail("scope", `UserSupplier ${a.id}: supplier of another business`);
  for (const a of await prisma.userAccount.findMany({ select: { id: true, businessId: true, account: { select: { businessId: true, customer: { select: { id: true } }, supplier: { select: { id: true } } } } } })) {
    if (a.account.businessId !== a.businessId) fail("scope", `UserAccount ${a.id}: account of another business`);
    if (a.account.customer || a.account.supplier) fail("scope", `UserAccount ${a.id}: a party ledger (assign it as a customer / supplier)`);
  }
  const members = new Set((await prisma.membership.findMany({ select: { userId: true, businessId: true } })).map((m) => `${m.userId}:${m.businessId}`));
  const stale = [...(await prisma.userCustomer.findMany({ select: { userId: true, businessId: true } })), ...(await prisma.userSupplier.findMany({ select: { userId: true, businessId: true } })), ...(await prisma.userAccount.findMany({ select: { userId: true, businessId: true } }))].filter((a) => !members.has(`${a.userId}:${a.businessId}`));
  if (stale.length) fail("scope", `${stale.length} assignment(s) of users who are no longer members`);
}

async function main() {
  await tenantCopies();
  await books();
  await stock();
  await assignments();
  if (problems.length) {
    console.log(`${problems.length} problem(s):\n` + problems.join("\n"));
    process.exitCode = 1;
  } else console.log("integrity audit: clean");
}

main().finally(() => prisma.$disconnect());

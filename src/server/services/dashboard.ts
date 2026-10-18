// Dashboard figures — every number comes from journal entries / vouchers / stock movements.
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { dayRange, toDateInput } from "@/lib/format";
import { balancesBefore, balancesByKind, sumBalances } from "./ledger";
import { profitAndLoss } from "./report";
import { partyAging } from "./aging";
import { expirySummary } from "./expiry";
import { rawRows, sql } from "@/lib/dialect";

const DAY = 86_400_000;

/** Collections (customer credits from receipts & sales, plus walk-in sales) grouped by day. */
async function collectionsByDay(businessId: string, gte: Date, lt: Date) {
  const rows = await rawRows<{ d: Date; amount: string }>(prisma, sql`
    SELECT d, SUM(amount)::text AS amount FROM (
      SELECT je."date" AS d, je."credit" AS amount
      FROM "JournalEntry" je JOIN "Account" a ON a."id" = je."accountId" JOIN "Voucher" v ON v."id" = je."voucherId"
      WHERE je."businessId" = ${businessId} AND je."book" = 'GENERAL' AND je."date" >= ${gte} AND je."date" < ${lt}
        AND a."kind" = 'CUSTOMER' AND je."credit" > 0 AND v."type" IN ('RECEIPT', 'SALES')
      UNION ALL
      SELECT v."date", v."amount" FROM "Voucher" v
      WHERE v."businessId" = ${businessId} AND v."book" = 'GENERAL' AND v."type" = 'SALES' AND v."partyAccountId" IS NULL AND v."date" >= ${gte} AND v."date" < ${lt}
    ) x GROUP BY d`);
  return rows.map((r) => ({ key: new Date(r.d).toISOString().slice(0, 10), amount: num(r.amount) }));
}

async function salesByDay(businessId: string, gte: Date, lt: Date) {
  const rows = await rawRows<{ d: Date; type: string; amount: string }>(prisma, sql`
    SELECT "date" AS d, "type"::text AS type, SUM("amount")::text AS amount FROM "Voucher"
    WHERE "businessId" = ${businessId} AND "book" = 'GENERAL' AND "date" >= ${gte} AND "date" < ${lt} AND "type" IN ('SALES', 'SALES_RETURN')
    GROUP BY 1, 2`);
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = new Date(r.d).toISOString().slice(0, 10);
    map.set(k, round2((map.get(k) ?? 0) + (r.type === "SALES" ? 1 : -1) * num(r.amount)));
  }
  return map;
}

export async function dashboardData(businessId: string, fiscalStartMonth: number) {
  const today = toDateInput();
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const todayRange = dayRange(today, today);
  const [y, m] = today.split("-").map(Number);
  const fyStartYear = m >= fiscalStartMonth ? y : y - 1;
  const fyStart = new Date(Date.UTC(fyStartYear, fiscalStartMonth - 1, 1));
  const fyEnd = new Date(Date.UTC(fyStartYear + 1, fiscalStartMonth - 1, 1));
  const d30 = new Date(todayDate.getTime() - 29 * DAY);

  const [cashNow, bankNow, customers, suppliers, todayTrade, todayPl, todayIncExp, todayCollection, inventory] = await Promise.all([
    balancesByKind(businessId, ["CASH"]),
    balancesByKind(businessId, ["BANK"]),
    balancesByKind(businessId, ["CUSTOMER"]),
    balancesByKind(businessId, ["SUPPLIER"]),
    prisma.voucher.groupBy({ by: ["type"], where: { businessId, book: "GENERAL", date: todayRange, type: { in: ["SALES", "PURCHASE", "SALES_RETURN", "PURCHASE_RETURN"] } }, _sum: { amount: true }, _count: true }),
    profitAndLoss(businessId, todayRange),
    rawRows<{ nature: string; amount: string }>(prisma, sql`
      SELECT a."nature"::text AS nature, SUM(je."debit" - je."credit")::text AS amount
      FROM "JournalEntry" je JOIN "Account" a ON a."id" = je."accountId" JOIN "AccountGroup" g ON g."id" = a."groupId"
      WHERE je."businessId" = ${businessId} AND je."book" = 'GENERAL' AND je."date" >= ${todayRange.gte} AND je."date" < ${todayRange.lt}
        AND a."nature" IN ('INCOME', 'EXPENSE') AND g."isDirect" = false
      GROUP BY a."nature"`),
    collectionsByDay(businessId, todayRange.gte!, todayRange.lt!),
    prisma.account.findFirst({ where: { businessId, systemKey: "INVENTORY" }, select: { id: true } }),
  ]);
  const stockValue = inventory ? (await balancesBefore(businessId, undefined, [inventory.id])).get(inventory.id) ?? 0 : 0;
  const trade = (t: string) => num(todayTrade.find((x) => x.type === t)?._sum.amount);
  const salesCount = todayTrade.find((x) => x.type === "SALES")?._count ?? 0;
  const incExp = (n: string) => num(todayIncExp.find((x) => x.nature === n)?.amount);

  const [recentSales, recentPayments, lowStock, aging, sales30, coll30, salesFy, collFy, expiring] = await Promise.all([
    prisma.voucher.findMany({ where: { businessId, book: "GENERAL", type: "SALES" }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 7, include: { partyAccount: { select: { name: true } } } }),
    prisma.voucher.findMany({ where: { businessId, book: "GENERAL", type: { in: ["RECEIPT", "PAYMENT"] } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 7, include: { partyAccount: { select: { name: true } }, cashAccount: { select: { name: true } } } }),
    rawRows<{ id: string; name: string; stock: string; minStock: string; unit: string }>(prisma, sql`
      SELECT p."id", p."name", p."stock"::text, p."minStock"::text, u."name" AS unit
      FROM "Product" p JOIN "Unit" u ON u."id" = p."unitId"
      WHERE p."businessId" = ${businessId} AND p."isActive" = true AND (p."stock" <= p."minStock" OR p."stock" <= 0)
      ORDER BY p."stock" ASC LIMIT 7`),
    partyAging(businessId, "CUSTOMER", todayDate),
    salesByDay(businessId, d30, todayRange.lt!),
    collectionsByDay(businessId, d30, todayRange.lt!),
    rawRows<{ month: Date; type: string; amount: string }>(prisma, sql`
      SELECT date_trunc('month', "date") AS month, "type"::text AS type, SUM("amount")::text AS amount FROM "Voucher"
      WHERE "businessId" = ${businessId} AND "book" = 'GENERAL' AND "date" >= ${fyStart} AND "date" < ${fyEnd} AND "type" IN ('SALES', 'SALES_RETURN')
      GROUP BY 1, 2`),
    collectionsByDay(businessId, fyStart, fyEnd),
    expirySummary(businessId, todayDate),
  ]);

  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(d30.getTime() + i * DAY);
    const key = d.toISOString().slice(0, 10);
    return { key, label: String(d.getUTCDate()), a: sales30.get(key) ?? 0, b: round2(coll30.filter((c) => c.key === key).reduce((s, c) => s + c.amount, 0)) };
  });
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(fyStart);
    d.setUTCMonth(d.getUTCMonth() + i);
    const key = d.toISOString().slice(0, 7);
    const sv = (t: string) => num(salesFy.find((x) => new Date(x.month).toISOString().slice(0, 7) === key && x.type === t)?.amount);
    return {
      key,
      month: d.getUTCMonth(),
      a: round2(sv("SALES") - sv("SALES_RETURN")),
      b: round2(collFy.filter((c) => c.key.startsWith(key)).reduce((s, c) => s + c.amount, 0)),
    };
  });
  const overdue = aging.filter((a) => a.overdue > 0).sort((a, b) => b.overdue - a.overdue);

  return {
    figures: {
      todaySales: round2(trade("SALES") - trade("SALES_RETURN")),
      salesCount,
      todayPurchase: round2(trade("PURCHASE") - trade("PURCHASE_RETURN")),
      todayCollection: round2(todayCollection.reduce((s, c) => s + c.amount, 0)),
      todayExpense: round2(incExp("EXPENSE")),
      todayIncome: round2(-incExp("INCOME")),
      todayProfit: todayPl.netProfit,
      receivable: sumBalances(customers),
      payable: round2(-sumBalances(suppliers)),
      cash: sumBalances(cashNow),
      bank: sumBalances(bankNow),
      stockValue: round2(stockValue),
      overdueTotal: round2(overdue.reduce((s, a) => s + a.overdue, 0)),
      overdueCount: overdue.length,
      expiringBatches: expiring.attention.length,
    },
    cashBank: [...cashNow, ...bankNow].map((a) => ({ id: a.id, name: a.name, kind: a.kind, balance: a.balance })),
    recentSales,
    recentPayments,
    lowStock,
    expiry: expiring,
    overdue: overdue.slice(0, 7),
    days,
    months,
  };
}

export type DashboardData = Awaited<ReturnType<typeof dashboardData>>;

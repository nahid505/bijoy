import "server-only";

import { prisma } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { naturalBalance, type Nature } from "@/lib/accounting";
import { accountMovements, balancesBefore, listAccounts, type AccountRow, type DateRange } from "./ledger";
import { listSisterConcerns } from "./company-group";
import type { BookFilter } from "@/lib/book";
import { UserError } from "@/lib/errors";

export interface EntityColumn {
  id: string;
  name: string;
  intercompanyCode: string | null;
  isParent: boolean;
}

export type GroupCoaCategory =
  | "CASH_BANK"
  | "RECEIVABLES"
  | "INVENTORY"
  | "INTERCOMPANY_DUE_FROM"
  | "OTHER_CURRENT_ASSETS"
  | "FIXED_ASSETS"
  | "PAYABLES"
  | "INTERCOMPANY_DUE_TO"
  | "CURRENT_LIABILITIES"
  | "LONG_TERM_LIABILITIES"
  | "CAPITAL"
  | "RETAINED_EARNINGS"
  | "CURRENT_PERIOD_PROFIT"
  | "SALES_REVENUE"
  | "INTERCOMPANY_SALES"
  | "OTHER_INCOME"
  | "COST_OF_SALES"
  | "INTERCOMPANY_PURCHASES"
  | "OPERATING_EXPENSES"
  | "FINANCE_TAX_EXPENSES";

export interface GroupCoaDefinition {
  category: GroupCoaCategory;
  name: string;
  nameEn: string;
  nature: Nature;
  statement: "BS_ASSET" | "BS_LIABILITY" | "BS_EQUITY" | "PL_REVENUE" | "PL_COGS" | "PL_OPEX" | "PL_OTHER";
  sortOrder: number;
}

export const GROUP_COA_CATALOG: Record<GroupCoaCategory, GroupCoaDefinition> = {
  // ── Assets
  CASH_BANK: {
    category: "CASH_BANK",
    name: "নগদ ও ব্যাংক তহবিল (Cash & Bank)",
    nameEn: "Cash & Cash Equivalents",
    nature: "ASSET",
    statement: "BS_ASSET",
    sortOrder: 10,
  },
  RECEIVABLES: {
    category: "RECEIVABLES",
    name: "ট্রেড দেনাদার / প্রাপ্য হিসাব (Trade Receivables)",
    nameEn: "Trade Accounts Receivable",
    nature: "ASSET",
    statement: "BS_ASSET",
    sortOrder: 20,
  },
  INTERCOMPANY_DUE_FROM: {
    category: "INTERCOMPANY_DUE_FROM",
    name: "আন্তঃপ্রতিষ্ঠান প্রাপ্য (Due from Sister Concerns)",
    nameEn: "Intercompany Due From",
    nature: "ASSET",
    statement: "BS_ASSET",
    sortOrder: 30,
  },
  INVENTORY: {
    category: "INVENTORY",
    name: "মজুদ পণ্য (Inventory / Stock)",
    nameEn: "Inventory & Stock in Trade",
    nature: "ASSET",
    statement: "BS_ASSET",
    sortOrder: 40,
  },
  OTHER_CURRENT_ASSETS: {
    category: "OTHER_CURRENT_ASSETS",
    name: "অগ্রিম ও অন্যান্য চলতি সম্পদ (Other Current Assets)",
    nameEn: "Prepayments & Other Current Assets",
    nature: "ASSET",
    statement: "BS_ASSET",
    sortOrder: 50,
  },
  FIXED_ASSETS: {
    category: "FIXED_ASSETS",
    name: "স্থায়ী সম্পদ ও সরঞ্জামাদি (Property, Plant & Equipment)",
    nameEn: "Fixed Assets & Property",
    nature: "ASSET",
    statement: "BS_ASSET",
    sortOrder: 60,
  },

  // ── Liabilities
  PAYABLES: {
    category: "PAYABLES",
    name: "ট্রেড পাওনাদার / প্রদেয় হিসাব (Trade Payables)",
    nameEn: "Trade Accounts Payable",
    nature: "LIABILITY",
    statement: "BS_LIABILITY",
    sortOrder: 110,
  },
  INTERCOMPANY_DUE_TO: {
    category: "INTERCOMPANY_DUE_TO",
    name: "আন্তঃপ্রতিষ্ঠান প্রদেয় (Due to Sister Concerns)",
    nameEn: "Intercompany Due To",
    nature: "LIABILITY",
    statement: "BS_LIABILITY",
    sortOrder: 120,
  },
  CURRENT_LIABILITIES: {
    category: "CURRENT_LIABILITIES",
    name: "স্বল্পমেয়াদি ঋণ ও চলতি দায় (Short Term Borrowings)",
    nameEn: "Short Term Borrowings & Accruals",
    nature: "LIABILITY",
    statement: "BS_LIABILITY",
    sortOrder: 130,
  },
  LONG_TERM_LIABILITIES: {
    category: "LONG_TERM_LIABILITIES",
    name: "দীর্ঘমেয়াদি ঋণ ও দায় (Long Term Liabilities)",
    nameEn: "Long Term Loans & Borrowings",
    nature: "LIABILITY",
    statement: "BS_LIABILITY",
    sortOrder: 140,
  },

  // ── Equity
  CAPITAL: {
    category: "CAPITAL",
    name: "শেয়ার মূলধন / মালিকের পুঁজী (Owner's Capital)",
    nameEn: "Share Capital & Equity",
    nature: "EQUITY",
    statement: "BS_EQUITY",
    sortOrder: 210,
  },
  RETAINED_EARNINGS: {
    category: "RETAINED_EARNINGS",
    name: "পুঞ্জীভূত মুনাফা (Retained Earnings)",
    nameEn: "Retained Earnings & Reserves",
    nature: "EQUITY",
    statement: "BS_EQUITY",
    sortOrder: 220,
  },
  CURRENT_PERIOD_PROFIT: {
    category: "CURRENT_PERIOD_PROFIT",
    name: "চলতি মেয়াদের নিট লাভ/ক্ষতি (Current Period Profit)",
    nameEn: "Current Period Net Profit",
    nature: "EQUITY",
    statement: "BS_EQUITY",
    sortOrder: 230,
  },

  // ── Income / Revenue
  SALES_REVENUE: {
    category: "SALES_REVENUE",
    name: "পণ্য ও সেবা বিক্রয় (Sales Revenue)",
    nameEn: "Operating Revenue & Sales",
    nature: "INCOME",
    statement: "PL_REVENUE",
    sortOrder: 310,
  },
  INTERCOMPANY_SALES: {
    category: "INTERCOMPANY_SALES",
    name: "আন্তঃপ্রতিষ্ঠান বিক্রয় (Intercompany Sales)",
    nameEn: "Intercompany Sales Revenue",
    nature: "INCOME",
    statement: "PL_REVENUE",
    sortOrder: 320,
  },
  OTHER_INCOME: {
    category: "OTHER_INCOME",
    name: "অন্যান্য পরিচালন ও বিবিধ আয় (Other Income)",
    nameEn: "Other Operating & Non-Operating Income",
    nature: "INCOME",
    statement: "PL_OTHER",
    sortOrder: 330,
  },

  // ── Expenses
  COST_OF_SALES: {
    category: "COST_OF_SALES",
    name: "বিক্রীত পণ্যের ব্যয় / সরাসরি ক্রয় (Cost of Goods Sold)",
    nameEn: "Cost of Goods Sold & Direct Material",
    nature: "EXPENSE",
    statement: "PL_COGS",
    sortOrder: 410,
  },
  INTERCOMPANY_PURCHASES: {
    category: "INTERCOMPANY_PURCHASES",
    name: "আন্তঃপ্রতিষ্ঠান ক্রয় (Intercompany Purchases)",
    nameEn: "Intercompany Purchases",
    nature: "EXPENSE",
    statement: "PL_COGS",
    sortOrder: 420,
  },
  OPERATING_EXPENSES: {
    category: "OPERATING_EXPENSES",
    name: "পরিচালন, অফিস ও সাধারণ ব্যয় (Operating Expenses)",
    nameEn: "Operating & Administrative Expenses",
    nature: "EXPENSE",
    statement: "PL_OPEX",
    sortOrder: 430,
  },
  FINANCE_TAX_EXPENSES: {
    category: "FINANCE_TAX_EXPENSES",
    name: "অবচয় ও আর্থিক খরচ (Depreciation & Financial Expenses)",
    nameEn: "Depreciation, Bank & Finance Costs",
    nature: "EXPENSE",
    statement: "PL_OPEX",
    sortOrder: 440,
  },
};

export interface ConsolidatedStatementLine {
  category: GroupCoaCategory;
  name: string;
  nameEn: string;
  nature: Nature;
  statement: string;
  entityBalances: Record<string, number>; // entityId -> balance
  rawTotal: number;
  eliminationDr: number;
  eliminationCr: number;
  consolidatedTotal: number;
  eliminationNote?: string | null;
}

export interface IntercompanyEliminationDetail {
  type: "SALES_PURCHASE" | "RECEIVABLE_PAYABLE";
  sellerOrCreditor: { id: string; name: string };
  buyerOrDebtor: { id: string; name: string };
  amount: number;
  drAccount: string;
  crAccount: string;
  description: string;
}

export interface ConsolidatedFinancialsResult {
  group: { id: string; name: string; code: string | null } | null;
  entities: EntityColumn[];
  asOfDate: Date;
  dateRange: { from?: Date; to?: Date };
  balanceSheet: {
    assets: ConsolidatedStatementLine[];
    liabilities: ConsolidatedStatementLine[];
    equity: ConsolidatedStatementLine[];
    totalAssets: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
    totalLiabilities: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
    totalEquity: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
    totalLiabilitiesAndEquity: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
    isBalanced: boolean;
  };
  profitAndLoss: {
    revenueLines: ConsolidatedStatementLine[];
    cogsLines: ConsolidatedStatementLine[];
    opexLines: ConsolidatedStatementLine[];
    otherIncomeLines: ConsolidatedStatementLine[];
    netSales: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
    costOfSales: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
    grossProfit: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
    operatingExpenses: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
    netProfit: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
  };
  trialBalance: {
    lines: ConsolidatedStatementLine[];
    totalDebit: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
    totalCredit: { entityValues: Record<string, number>; rawTotal: number; elimination: number; consolidated: number };
    isBalanced: boolean;
  };
  eliminations: IntercompanyEliminationDetail[];
}

/**
 * Asserts that the current session / context has access to consolidated financial statements.
 * Allowed for:
 * 1. Super Admin
 * 2. Parent Company Owner
 * 3. Users with role 'GROUP_AUDITOR'
 * 4. Contexts where canConsolidate is granted
 */
export function assertConsolidatedAccess(ctx: {
  user: { isSuperAdmin: boolean };
  isOwner?: boolean;
  roleName?: string;
  group?: { isParent: boolean; canConsolidate?: boolean } | null;
}): void {
  const role = (ctx.roleName ?? "").toUpperCase();
  const isGroupAuditor = role === "GROUP_AUDITOR" || role.includes("GROUP AUDITOR");
  const isParentOwner = Boolean(ctx.isOwner && ctx.group?.isParent);
  const canConsolidate = Boolean(ctx.group?.canConsolidate);

  if (!ctx.user.isSuperAdmin && !isGroupAuditor && !isParentOwner && !canConsolidate) {
    throw new UserError("কনসোলিডেটেড গ্রুপ রিপোর্ট দেখার অনুমতি শুধুমাত্র সুপার এডমিন, প্যারেন্ট কোম্পানির মালিক অথবা GROUP_AUDITOR রোলের জন্য সংরক্ষিত।");
  }
}

/**
 * Maps a single business ledger account to a Global Group COA category.
 */
export function mapAccountToGroupCoa(
  account: AccountRow,
  isSisterParty: { isCustomer: boolean; isSupplier: boolean }
): GroupCoaCategory {
  // Intercompany party accounts mapped directly
  if (isSisterParty.isCustomer) return "INTERCOMPANY_DUE_FROM";
  if (isSisterParty.isSupplier) return "INTERCOMPANY_DUE_TO";

  const key = account.groupKey ?? "";

  // 1. Assets
  if (account.nature === "ASSET") {
    if (key === "CASH" || key === "BANK_ACCOUNTS" || account.kind === "CASH" || account.kind === "BANK") return "CASH_BANK";
    if (key === "SUNDRY_DEBTORS" || account.kind === "CUSTOMER") return "RECEIVABLES";
    if (key === "INVENTORY") return "INVENTORY";
    if (key === "FIXED_ASSETS" || /স্থায়ী সম্পদ|মেশিন|যন্ত্রপাতি|আসবাবপত্র/i.test(account.name)) return "FIXED_ASSETS";
    return "OTHER_CURRENT_ASSETS";
  }

  // 2. Liabilities
  if (account.nature === "LIABILITY") {
    if (key === "SUNDRY_CREDITORS" || account.kind === "SUPPLIER") return "PAYABLES";
    if (key === "SECURED_LOANS" || key === "UNSECURED_LOANS" || /ঋণ|লোন/i.test(account.name)) return "LONG_TERM_LIABILITIES";
    return "CURRENT_LIABILITIES";
  }

  // 3. Equity
  if (account.nature === "EQUITY") {
    if (key === "CAPITAL" || /মূলধন|পুঁজী|শেয়ার/i.test(account.name)) return "CAPITAL";
    return "RETAINED_EARNINGS";
  }

  // 4. Income
  if (account.nature === "INCOME") {
    if (key === "SALES" || account.isDirect || /বিক্রয়|সেলস|টার্নওভার/i.test(account.name)) return "SALES_REVENUE";
    return "OTHER_INCOME";
  }

  // 5. Expense
  if (account.nature === "EXPENSE") {
    if (key === "PURCHASE" || account.isDirect || /ক্রয়|পারচেজ/i.test(account.name)) return "COST_OF_SALES";
    if (/ব্যাংক চার্জ|সুদ|ট্যাক্স|অবচয়|Depreciation/i.test(account.name)) return "FINANCE_TAX_EXPENSES";
    return "OPERATING_EXPENSES";
  }

  return "OTHER_CURRENT_ASSETS";
}

/**
 * Consolidated Financials Engine:
 * Aggregates Trial Balance, Balance Sheet, and P&L across all entities in an Enterprise Group,
 * and executes automated intercompany elimination for internal sales/purchases and reciprocal contra dues.
 */
export async function getConsolidatedFinancials(
  businessId: string,
  options: {
    asOf?: Date;
    from?: Date;
    to?: Date;
    book?: BookFilter;
  } = {}
): Promise<ConsolidatedFinancialsResult> {
  const asOf = options.asOf ?? new Date();
  const dateRange: DateRange = {
    gte: options.from,
    lt: options.to ?? asOf,
  };
  const book = options.book ?? "GENERAL";

  // 1. Identify all entities in the group
  const sisterData = await listSisterConcerns(businessId);
  let entities: EntityColumn[] = [];
  const group = sisterData.group;

  if (sisterData.inGroup && sisterData.sisterConcerns.length > 0) {
    entities = sisterData.sisterConcerns.map((s) => ({
      id: s.id,
      name: s.name,
      intercompanyCode: s.intercompanyCode,
      isParent: s.isParent,
    }));
  } else {
    // Single business fallback
    const single = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { id: true, name: true, intercompanyCode: true, isParent: true },
    });
    entities = [{ id: single.id, name: single.name, intercompanyCode: single.intercompanyCode, isParent: single.isParent }];
  }

  const entityIds = entities.map((e) => e.id);

  // 2. Query sister concern customer & supplier relationships across all entities
  const [sisterCustomers, sisterSuppliers] = await Promise.all([
    prisma.customer.findMany({
      where: { businessId: { in: entityIds }, isSisterConcern: true, linkedBusinessId: { in: entityIds } },
      select: { businessId: true, accountId: true, linkedBusinessId: true },
    }),
    prisma.supplier.findMany({
      where: { businessId: { in: entityIds }, isSisterConcern: true, linkedBusinessId: { in: entityIds } },
      select: { businessId: true, accountId: true, linkedBusinessId: true },
    }),
  ]);

  const sisterCustomerAccountIds = new Set(sisterCustomers.map((c) => c.accountId));
  const sisterSupplierAccountIds = new Set(sisterSuppliers.map((s) => s.accountId));

  // 3. Collect balances for each entity
  // Map: category -> entityId -> balance
  const balanceSheetMap = new Map<GroupCoaCategory, Record<string, number>>();
  const pnlMap = new Map<GroupCoaCategory, Record<string, number>>();
  const tbMap = new Map<GroupCoaCategory, Record<string, number>>();

  // Initialize maps
  for (const cat of Object.keys(GROUP_COA_CATALOG) as GroupCoaCategory[]) {
    balanceSheetMap.set(cat, {});
    pnlMap.set(cat, {});
    tbMap.set(cat, {});
    for (const ent of entities) {
      balanceSheetMap.get(cat)![ent.id] = 0;
      pnlMap.get(cat)![ent.id] = 0;
      tbMap.get(cat)![ent.id] = 0;
    }
  }

  // Track each entity's P&L Net Profit for Balance Sheet Roll-up
  const entityNetProfits: Record<string, number> = {};
  for (const ent of entities) entityNetProfits[ent.id] = 0;

  for (const ent of entities) {
    const [accounts, bsBalances, periodMovements] = await Promise.all([
      listAccounts(ent.id),
      balancesBefore(ent.id, asOf, undefined, book),
      accountMovements(ent.id, dateRange, undefined, book),
    ]);

    let entityRevenueTotal = 0;
    let entityExpenseTotal = 0;

    for (const acc of accounts) {
      const isSister = {
        isCustomer: sisterCustomerAccountIds.has(acc.id),
        isSupplier: sisterSupplierAccountIds.has(acc.id),
      };
      const category = mapAccountToGroupCoa(acc, isSister);
      const def = GROUP_COA_CATALOG[category];

      // Balance Sheet balance (cumulative before asOf)
      const rawBsBalance = bsBalances.get(acc.id) ?? 0;
      const naturalBsBal = naturalBalance(def.nature, rawBsBalance);

      // PnL period movement
      const move = periodMovements.get(acc.id) ?? { debit: 0, credit: 0 };
      const naturalPlBal = naturalBalance(def.nature, move.debit - move.credit);

      if (def.nature === "INCOME") entityRevenueTotal = round2(entityRevenueTotal + naturalPlBal);
      if (def.nature === "EXPENSE") entityExpenseTotal = round2(entityExpenseTotal + naturalPlBal);

      // Accumulate
      if (def.nature === "ASSET" || def.nature === "LIABILITY" || def.nature === "EQUITY") {
        balanceSheetMap.get(category)![ent.id] = round2(
          balanceSheetMap.get(category)![ent.id] + naturalBsBal
        );
      } else {
        pnlMap.get(category)![ent.id] = round2(
          pnlMap.get(category)![ent.id] + naturalPlBal
        );
      }

      // TB net movement: debit - credit
      tbMap.get(category)![ent.id] = round2(
        tbMap.get(category)![ent.id] + (rawBsBalance !== 0 ? rawBsBalance : move.debit - move.credit)
      );
    }

    const netProfit = round2(entityRevenueTotal - entityExpenseTotal);
    entityNetProfits[ent.id] = netProfit;
    balanceSheetMap.get("CURRENT_PERIOD_PROFIT")![ent.id] = netProfit;
  }

  // 4. Automated Intercompany Elimination Engine
  const eliminations: IntercompanyEliminationDetail[] = [];

  // A) Intercompany Sales / Purchase Elimination
  // Query vouchers between sister concerns in the group within the period
  const intercompanyVouchers = await prisma.voucher.findMany({
    where: {
      businessId: { in: entityIds },
      isIntercompany: true,
      bilateralStatus: { in: ["ACCEPTED", "PENDING"] },
      type: "SALES",
      ...(dateRange.gte || dateRange.lt ? { date: dateRange } : {}),
    },
    include: {
      business: { select: { id: true, name: true } },
      partyAccount: {
        select: {
          customer: { select: { linkedBusiness: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  let totalIntercompanySalesElimination = 0;

  for (const v of intercompanyVouchers) {
    const seller = v.business;
    const buyer = v.partyAccount?.customer?.linkedBusiness;
    if (buyer && entityIds.includes(buyer.id)) {
      const amount = Number(v.amount);
      totalIntercompanySalesElimination = round2(totalIntercompanySalesElimination + amount);

      eliminations.push({
        type: "SALES_PURCHASE",
        sellerOrCreditor: seller,
        buyerOrDebtor: buyer,
        amount,
        drAccount: "আন্তঃপ্রতিষ্ঠান বিক্রয় (Sales Revenue)",
        crAccount: "আন্তঃপ্রতিষ্ঠান ক্রয় (Cost of Goods Sold)",
        description: `অভ্যন্তরীণ বিক্রয়-ক্রয় চালান #${v.voucherNo} সমন্বয়`,
      });
    }
  }

  // B) Intercompany Receivable / Payable Contra Elimination
  let totalIntercompanyDueFrom = 0;
  let totalIntercompanyDueTo = 0;

  for (const ent of entities) {
    totalIntercompanyDueFrom = round2(totalIntercompanyDueFrom + (balanceSheetMap.get("INTERCOMPANY_DUE_FROM")![ent.id] || 0));
    totalIntercompanyDueTo = round2(totalIntercompanyDueTo + (balanceSheetMap.get("INTERCOMPANY_DUE_TO")![ent.id] || 0));
  }

  const intercompanyBalanceElimination = round2(Math.min(totalIntercompanyDueFrom, totalIntercompanyDueTo));

  if (intercompanyBalanceElimination > 0) {
    eliminations.push({
      type: "RECEIVABLE_PAYABLE",
      sellerOrCreditor: { id: "GROUP", name: "গ্রুপ অভ্যন্তরীণ দেনাদার" },
      buyerOrDebtor: { id: "GROUP", name: "গ্রুপ অভ্যন্তরীণ পাওনাদার" },
      amount: intercompanyBalanceElimination,
      drAccount: "আন্তঃপ্রতিষ্ঠান প্রদেয় (Intercompany Due To)",
      crAccount: "আন্তঃপ্রতিষ্ঠান প্রাপ্য (Intercompany Due From)",
      description: "পারস্পরিক দেনা-পাওনা কন্ট্রা ব্যালেন্স শিট সমন্বয়",
    });
  }

  // 5. Construct Statement Lines with Multi-Column & Consolidated Totals
  const buildLine = (
    cat: GroupCoaCategory,
    sourceMap: Map<GroupCoaCategory, Record<string, number>>,
    eliminationDr = 0,
    eliminationCr = 0,
    note: string | null = null
  ): ConsolidatedStatementLine => {
    const def = GROUP_COA_CATALOG[cat];
    const entityBalances = { ...sourceMap.get(cat)! };
    const rawTotal = round2(Object.values(entityBalances).reduce((s, b) => s + b, 0));

    // Effect of eliminations:
    // For Assets/Expenses (normal debit): Dr adds, Cr subtracts
    // For Liabilities/Equity/Income (normal credit): Cr adds, Dr subtracts
    let consolidatedTotal = rawTotal;
    if (def.nature === "ASSET" || def.nature === "EXPENSE") {
      consolidatedTotal = round2(rawTotal + eliminationDr - eliminationCr);
    } else {
      consolidatedTotal = round2(rawTotal + eliminationCr - eliminationDr);
    }

    return {
      category: cat,
      name: def.name,
      nameEn: def.nameEn,
      nature: def.nature,
      statement: def.statement,
      entityBalances,
      rawTotal,
      eliminationDr,
      eliminationCr,
      consolidatedTotal,
      eliminationNote: note,
    };
  };

  // ── Profit & Loss Lines
  const revenueLines = [
    buildLine("SALES_REVENUE", pnlMap, totalIntercompanySalesElimination, 0, totalIntercompanySalesElimination > 0 ? "ইন্টার-কোম্পানি সেলস বাদ" : null),
    buildLine("INTERCOMPANY_SALES", pnlMap, 0, 0),
  ].filter((l) => l.rawTotal !== 0 || l.consolidatedTotal !== 0);

  const cogsLines = [
    buildLine("COST_OF_SALES", pnlMap, 0, totalIntercompanySalesElimination, totalIntercompanySalesElimination > 0 ? "ইন্টার-কোম্পানি পারচেজ বাদ" : null),
    buildLine("INTERCOMPANY_PURCHASES", pnlMap, 0, 0),
  ].filter((l) => l.rawTotal !== 0 || l.consolidatedTotal !== 0);

  const opexLines = [
    buildLine("OPERATING_EXPENSES", pnlMap),
    buildLine("FINANCE_TAX_EXPENSES", pnlMap),
  ].filter((l) => l.rawTotal !== 0 || l.consolidatedTotal !== 0);

  const otherIncomeLines = [
    buildLine("OTHER_INCOME", pnlMap),
  ].filter((l) => l.rawTotal !== 0 || l.consolidatedTotal !== 0);

  const sumTotals = (lines: ConsolidatedStatementLine[]) => {
    const entityValues: Record<string, number> = {};
    for (const ent of entities) {
      entityValues[ent.id] = round2(lines.reduce((s, l) => s + (l.entityBalances[ent.id] || 0), 0));
    }
    const rawTotal = round2(lines.reduce((s, l) => s + l.rawTotal, 0));
    const elimination = round2(lines.reduce((s, l) => s + (l.eliminationDr - l.eliminationCr), 0));
    const consolidated = round2(lines.reduce((s, l) => s + l.consolidatedTotal, 0));
    return { entityValues, rawTotal, elimination, consolidated };
  };

  const netSales = sumTotals(revenueLines);
  const costOfSales = sumTotals(cogsLines);

  const grossProfit = {
    entityValues: Object.fromEntries(entities.map((e) => [e.id, round2(netSales.entityValues[e.id] - costOfSales.entityValues[e.id])])),
    rawTotal: round2(netSales.rawTotal - costOfSales.rawTotal),
    elimination: round2(netSales.elimination - costOfSales.elimination),
    consolidated: round2(netSales.consolidated - costOfSales.consolidated),
  };

  const operatingExpenses = sumTotals(opexLines);
  const otherIncome = sumTotals(otherIncomeLines);

  const netProfit = {
    entityValues: Object.fromEntries(
      entities.map((e) => [
        e.id,
        round2(grossProfit.entityValues[e.id] + otherIncome.entityValues[e.id] - operatingExpenses.entityValues[e.id]),
      ])
    ),
    rawTotal: round2(grossProfit.rawTotal + otherIncome.rawTotal - operatingExpenses.rawTotal),
    elimination: round2(grossProfit.elimination + otherIncome.elimination - operatingExpenses.elimination),
    consolidated: round2(grossProfit.consolidated + otherIncome.consolidated - operatingExpenses.consolidated),
  };

  // ── Balance Sheet Lines
  const assetLines = [
    buildLine("CASH_BANK", balanceSheetMap),
    buildLine("RECEIVABLES", balanceSheetMap),
    buildLine("INTERCOMPANY_DUE_FROM", balanceSheetMap, 0, intercompanyBalanceElimination, intercompanyBalanceElimination > 0 ? "পারস্পরিক দেনা-পাওনা সমন্বয়" : null),
    buildLine("INVENTORY", balanceSheetMap),
    buildLine("OTHER_CURRENT_ASSETS", balanceSheetMap),
    buildLine("FIXED_ASSETS", balanceSheetMap),
  ].filter((l) => l.rawTotal !== 0 || l.consolidatedTotal !== 0);

  const liabilityLines = [
    buildLine("PAYABLES", balanceSheetMap),
    buildLine("INTERCOMPANY_DUE_TO", balanceSheetMap, intercompanyBalanceElimination, 0, intercompanyBalanceElimination > 0 ? "পারস্পরিক দেনা-পাওনা সমন্বয়" : null),
    buildLine("CURRENT_LIABILITIES", balanceSheetMap),
    buildLine("LONG_TERM_LIABILITIES", balanceSheetMap),
  ].filter((l) => l.rawTotal !== 0 || l.consolidatedTotal !== 0);

  const equityLines = [
    buildLine("CAPITAL", balanceSheetMap),
    buildLine("RETAINED_EARNINGS", balanceSheetMap),
    buildLine("CURRENT_PERIOD_PROFIT", balanceSheetMap),
  ].filter((l) => l.rawTotal !== 0 || l.consolidatedTotal !== 0);

  const totalAssets = sumTotals(assetLines);
  const totalLiabilities = sumTotals(liabilityLines);
  const totalEquity = sumTotals(equityLines);

  const totalLiabilitiesAndEquity = {
    entityValues: Object.fromEntries(
      entities.map((e) => [e.id, round2(totalLiabilities.entityValues[e.id] + totalEquity.entityValues[e.id])])
    ),
    rawTotal: round2(totalLiabilities.rawTotal + totalEquity.rawTotal),
    elimination: round2(totalLiabilities.elimination + totalEquity.elimination),
    consolidated: round2(totalLiabilities.consolidated + totalEquity.consolidated),
  };

  const isBsBalanced = Math.abs(totalAssets.consolidated - totalLiabilitiesAndEquity.consolidated) < 0.05;

  // ── Trial Balance Lines
  const tbLines: ConsolidatedStatementLine[] = (
    Object.keys(GROUP_COA_CATALOG) as GroupCoaCategory[]
  )
    .map((cat) => {
      let elimDr = 0;
      let elimCr = 0;

      if (cat === "SALES_REVENUE" || cat === "INTERCOMPANY_SALES") elimDr = totalIntercompanySalesElimination;
      if (cat === "COST_OF_SALES" || cat === "INTERCOMPANY_PURCHASES") elimCr = totalIntercompanySalesElimination;
      if (cat === "INTERCOMPANY_DUE_TO" || cat === "PAYABLES") elimDr += intercompanyBalanceElimination;
      if (cat === "INTERCOMPANY_DUE_FROM" || cat === "RECEIVABLES") elimCr += intercompanyBalanceElimination;

      return buildLine(cat, tbMap, elimDr, elimCr);
    })
    .filter((l) => l.rawTotal !== 0 || l.consolidatedTotal !== 0 || l.eliminationDr !== 0 || l.eliminationCr !== 0);

  const tbDebitLines = tbLines.filter((l) => l.nature === "ASSET" || l.nature === "EXPENSE");
  const tbCreditLines = tbLines.filter((l) => l.nature === "LIABILITY" || l.nature === "EQUITY" || l.nature === "INCOME");

  const totalDebit = sumTotals(tbDebitLines);
  const totalCredit = sumTotals(tbCreditLines);
  const isTbBalanced = Math.abs(totalDebit.consolidated - totalCredit.consolidated) < 0.05;

  return {
    group,
    entities,
    asOfDate: asOf,
    dateRange: { from: options.from, to: options.to },
    balanceSheet: {
      assets: assetLines,
      liabilities: liabilityLines,
      equity: equityLines,
      totalAssets,
      totalLiabilities,
      totalEquity,
      totalLiabilitiesAndEquity,
      isBalanced: isBsBalanced,
    },
    profitAndLoss: {
      revenueLines,
      cogsLines,
      opexLines,
      otherIncomeLines,
      netSales,
      costOfSales,
      grossProfit,
      operatingExpenses,
      netProfit,
    },
    trialBalance: {
      lines: tbLines,
      totalDebit,
      totalCredit,
      isBalanced: isTbBalanced,
    },
    eliminations,
  };
}

/**
 * Exports Consolidated Financial Statements to a multi-worksheet Excel (.xlsx) workbook.
 */
export async function exportConsolidatedFinancialsToXlsx(
  report: ConsolidatedFinancialsResult,
  currency = "৳"
): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bijoy Lenden ERP";
  wb.created = new Date();

  const groupName = report.group?.name || "সম্মিলিত গ্রুপ (Consolidated Group)";
  const entityHeaders = report.entities.map((e) => e.name + (e.intercompanyCode ? ` [${e.intercompanyCode}]` : ""));

  // Helper to style a worksheet header
  const addHeader = (ws: any, title: string) => {
    ws.addRow([groupName]).font = { bold: true, size: 14 };
    ws.addRow([title]).font = { bold: true, size: 12 };
    ws.addRow([`তারিখ: ${report.asOfDate.toISOString().slice(0, 10)} | মুদ্রা: ${currency}`]).font = { size: 10, italic: true };
    ws.addRow([]);

    const headRow = ws.addRow([
      "লেজার খাত (Group COA)",
      ...entityHeaders,
      "মোট (Raw Total)",
      "এলিমিনেশন Dr (Tk)",
      "এলিমিনেশন Cr (Tk)",
      "কনসোলিডেটেড মোট (Consolidated Total)",
      "সমন্বয় নোট (Elimination Notes)",
    ]);
    headRow.font = { bold: true };
    headRow.eachCell((cell: any) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9F0F8" } };
      cell.border = { bottom: { style: "thin" } };
    });
  };

  // ── Sheet 1: Consolidated Balance Sheet
  const wsBs = wb.addWorksheet("ব্যালেন্স শীট (Balance Sheet)");
  addHeader(wsBs, "কনসোলিডেটেড ব্যালেন্স শীট (Consolidated Balance Sheet)");

  const addBsSection = (title: string, lines: ConsolidatedStatementLine[]) => {
    const secRow = wsBs.addRow([title]);
    secRow.font = { bold: true, size: 11, color: { argb: "FF1E3A8A" } };
    for (const l of lines) {
      wsBs.addRow([
        l.name,
        ...report.entities.map((e) => l.entityBalances[e.id] || 0),
        l.rawTotal,
        l.eliminationDr || null,
        l.eliminationCr || null,
        l.consolidatedTotal,
        l.eliminationNote || "",
      ]);
    }
  };

  addBsSection("১. সম্পদসমূহ (ASSETS)", report.balanceSheet.assets);
  const assetTotalRow = wsBs.addRow([
    "সর্বমোট সম্পদ (Total Assets)",
    ...report.entities.map((e) => report.balanceSheet.totalAssets.entityValues[e.id] || 0),
    report.balanceSheet.totalAssets.rawTotal,
    null,
    null,
    report.balanceSheet.totalAssets.consolidated,
  ]);
  assetTotalRow.font = { bold: true };

  wsBs.addRow([]);
  addBsSection("২. দায়সমূহ (LIABILITIES)", report.balanceSheet.liabilities);
  addBsSection("৩. মালিকানাস্বত্ব (EQUITY)", report.balanceSheet.equity);

  const liabEqTotalRow = wsBs.addRow([
    "মোট দায় ও মূলধন (Total Liabilities & Equity)",
    ...report.entities.map((e) => report.balanceSheet.totalLiabilitiesAndEquity.entityValues[e.id] || 0),
    report.balanceSheet.totalLiabilitiesAndEquity.rawTotal,
    null,
    null,
    report.balanceSheet.totalLiabilitiesAndEquity.consolidated,
  ]);
  liabEqTotalRow.font = { bold: true };

  // ── Sheet 2: Consolidated Profit & Loss
  const wsPnl = wb.addWorksheet("লাভ-ক্ষতি (P&L)");
  addHeader(wsPnl, "কনসোলিডেটেড লাভ-ক্ষতি বিবরণী (Consolidated Profit & Loss)");

  const addPnlSection = (title: string, lines: ConsolidatedStatementLine[]) => {
    const secRow = wsPnl.addRow([title]);
    secRow.font = { bold: true, size: 11, color: { argb: "FF065F46" } };
    for (const l of lines) {
      wsPnl.addRow([
        l.name,
        ...report.entities.map((e) => l.entityBalances[e.id] || 0),
        l.rawTotal,
        l.eliminationDr || null,
        l.eliminationCr || null,
        l.consolidatedTotal,
        l.eliminationNote || "",
      ]);
    }
  };

  addPnlSection("১. রাজস্ব ও পরিচালন আয় (Revenue)", report.profitAndLoss.revenueLines);
  addPnlSection("২. সরাসরি ব্যয় ও ক্রয় (Cost of Sales)", report.profitAndLoss.cogsLines);

  const gpRow = wsPnl.addRow([
    "মোট লাভ (Gross Profit)",
    ...report.entities.map((e) => report.profitAndLoss.grossProfit.entityValues[e.id] || 0),
    report.profitAndLoss.grossProfit.rawTotal,
    null,
    null,
    report.profitAndLoss.grossProfit.consolidated,
  ]);
  gpRow.font = { bold: true };

  wsPnl.addRow([]);
  addPnlSection("৩. পরিচালন ও প্রশাসনিক ব্যয় (Operating Expenses)", report.profitAndLoss.opexLines);
  addPnlSection("৪. অন্যান্য বিবিধ আয় (Other Income)", report.profitAndLoss.otherIncomeLines);

  const npRow = wsPnl.addRow([
    "নিট মুনাফা (Net Profit)",
    ...report.entities.map((e) => report.profitAndLoss.netProfit.entityValues[e.id] || 0),
    report.profitAndLoss.netProfit.rawTotal,
    null,
    null,
    report.profitAndLoss.netProfit.consolidated,
  ]);
  npRow.font = { bold: true };

  // ── Sheet 3: Elimination Audit Trail
  const wsElim = wb.addWorksheet("এলিমিনেশন অডিট (Eliminations)");
  wsElim.addRow([groupName]).font = { bold: true, size: 14 };
  wsElim.addRow(["ইন্টার-কোম্পানি এলিমিনেশন অডিট ট্রেইল (Intercompany Eliminations Log)"]).font = { bold: true, size: 12 };
  wsElim.addRow([]);

  const elimHead = wsElim.addRow(["ধরন (Type)", "পক্ষ ১ (Entity A)", "পক্ষ ২ (Entity B)", "টাকার পরিমাণ (Amount)", "ডেবিট হিসাব", "ক্রেডিট হিসাব", "বিবরণ ও কারণ"]);
  elimHead.font = { bold: true };
  elimHead.eachCell((cell: any) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
  });

  for (const el of report.eliminations) {
    wsElim.addRow([
      el.type === "SALES_PURCHASE" ? "বিক্রয়-ক্রয় সমন্বয়" : "দেনা-পাওনা কন্ট্রা",
      el.sellerOrCreditor.name,
      el.buyerOrDebtor.name,
      el.amount,
      el.drAccount,
      el.crAccount,
      el.description,
    ]);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

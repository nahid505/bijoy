// ReportService — financial statements computed exclusively from journal entries.
import { round2 } from "@/lib/calc";
import { naturalBalance, type Nature } from "@/lib/accounting";
import { accountMovements, balancesBefore, listAccounts, type AccountRow, type DateRange } from "./ledger";

// ───────────────────────── trial balance ─────────────────────────

export interface TrialBalanceRow extends AccountRow {
  opening: number; // debit − credit before range
  debit: number;
  credit: number;
  closing: number; // debit − credit at end of range
}

export async function trialBalance(businessId: string, range: DateRange) {
  const [accounts, openings, period] = await Promise.all([
    listAccounts(businessId),
    range.gte ? balancesBefore(businessId, range.gte) : Promise.resolve(new Map<string, number>()),
    accountMovements(businessId, range),
  ]);
  const rows: TrialBalanceRow[] = accounts
    .map((a) => {
      const opening = openings.get(a.id) ?? 0;
      const m = period.get(a.id) ?? { debit: 0, credit: 0 };
      return { ...a, opening, debit: round2(m.debit), credit: round2(m.credit), closing: round2(opening + m.debit - m.credit) };
    })
    .filter((r) => r.opening !== 0 || r.debit !== 0 || r.credit !== 0);

  const sum = (f: (r: TrialBalanceRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
  const totals = {
    openingDebit: sum((r) => Math.max(r.opening, 0)),
    openingCredit: sum((r) => Math.max(-r.opening, 0)),
    debit: sum((r) => r.debit),
    credit: sum((r) => r.credit),
    closingDebit: sum((r) => Math.max(r.closing, 0)),
    closingCredit: sum((r) => Math.max(-r.closing, 0)),
  };
  return { rows, totals, balanced: totals.closingDebit === totals.closingCredit && totals.debit === totals.credit };
}

// ───────────────────────── profit & loss ─────────────────────────

export interface PlLine {
  accountId: string;
  name: string;
  group: string;
  amount: number;
}

export interface ProfitLoss {
  salesLines: PlLine[]; // direct income (sales, less sales return)
  netSales: number;
  directExpenseLines: PlLine[]; // cost of goods sold etc.
  directExpenses: number;
  grossProfit: number;
  otherIncomeLines: PlLine[];
  otherIncome: number;
  expenseLines: PlLine[];
  expenses: number;
  netProfit: number;
}

export async function profitAndLoss(businessId: string, range: DateRange): Promise<ProfitLoss> {
  const [accounts, period] = await Promise.all([
    listAccounts(businessId, { nature: { in: ["INCOME", "EXPENSE"] } }),
    accountMovements(businessId, range),
  ]);
  const line = (a: AccountRow): PlLine => {
    const m = period.get(a.id) ?? { debit: 0, credit: 0 };
    return { accountId: a.id, name: a.name, group: a.groupName, amount: naturalBalance(a.nature as Nature, m.debit - m.credit) };
  };
  const pick = (nature: "INCOME" | "EXPENSE", direct: boolean) =>
    accounts.filter((a) => a.nature === nature && a.isDirect === direct).map(line).filter((l) => l.amount !== 0);
  const total = (ls: PlLine[]) => round2(ls.reduce((s, l) => s + l.amount, 0));

  const salesLines = pick("INCOME", true);
  const directExpenseLines = pick("EXPENSE", true);
  const otherIncomeLines = pick("INCOME", false);
  const expenseLines = pick("EXPENSE", false);
  const netSales = total(salesLines);
  const directExpenses = total(directExpenseLines);
  const grossProfit = round2(netSales - directExpenses);
  const otherIncome = total(otherIncomeLines);
  const expenses = total(expenseLines);
  return {
    salesLines, netSales, directExpenseLines, directExpenses, grossProfit,
    otherIncomeLines, otherIncome, expenseLines, expenses,
    netProfit: round2(grossProfit + otherIncome - expenses),
  };
}

// ───────────────────────── balance sheet ─────────────────────────

export interface BsGroup {
  name: string;
  lines: { accountId: string; name: string; amount: number }[];
  total: number;
}

export interface BalanceSheet {
  assets: BsGroup[];
  liabilities: BsGroup[];
  equity: BsGroup[];
  currentProfit: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number; // including current profit
  totalLiabilitiesAndEquity: number;
  difference: number; // must be 0
}

export async function balanceSheet(businessId: string, asOfExclusive: Date): Promise<BalanceSheet> {
  const [accounts, bal] = await Promise.all([listAccounts(businessId), balancesBefore(businessId, asOfExclusive)]);
  const group = (nature: Nature): BsGroup[] => {
    const map = new Map<string, BsGroup & { sort: number }>();
    for (const a of accounts.filter((x) => x.nature === nature)) {
      const amount = naturalBalance(nature, bal.get(a.id) ?? 0);
      if (amount === 0) continue;
      const g = map.get(a.groupId) ?? { name: a.groupName, lines: [], total: 0, sort: a.groupSort };
      g.lines.push({ accountId: a.id, name: a.name, amount });
      g.total = round2(g.total + amount);
      map.set(a.groupId, g);
    }
    return [...map.values()].sort((x, y) => x.sort - y.sort).map(({ name, lines, total }) => ({ name, lines, total }));
  };
  const net = (n: Nature) => round2(accounts.filter((a) => a.nature === n).reduce((s, a) => s + naturalBalance(n, bal.get(a.id) ?? 0), 0));

  const assets = group("ASSET");
  const liabilities = group("LIABILITY");
  const equity = group("EQUITY");
  const currentProfit = round2(net("INCOME") - net("EXPENSE"));
  const totalAssets = round2(assets.reduce((s, g) => s + g.total, 0));
  const totalLiabilities = round2(liabilities.reduce((s, g) => s + g.total, 0));
  const totalEquity = round2(equity.reduce((s, g) => s + g.total, 0) + currentProfit);
  const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquity);
  return {
    assets, liabilities, equity, currentProfit,
    totalAssets, totalLiabilities, totalEquity, totalLiabilitiesAndEquity,
    difference: round2(totalAssets - totalLiabilitiesAndEquity),
  };
}

export type RentedMillRole = "SUPER_ADMIN" | "ACCOUNTANT" | "PARTNER" | "GUEST";

export const DEFAULT_DRYER_NAMES = ["ডায়ার-১", "ডায়ার-২", "ডায়ার-৩", "ডায়ার-৪"];

export function parseDryerNames(raw?: string | null): string[] {
  if (!raw) return DEFAULT_DRYER_NAMES;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const cleaned = parsed.map((s) => String(s).trim()).filter(Boolean);
      return cleaned.length > 0 ? cleaned : DEFAULT_DRYER_NAMES;
    }
  } catch {}
  return DEFAULT_DRYER_NAMES;
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  "মাসিক মিল ভাড়া",
  "বিদ্যুৎ বিল",
  "লেবার খরচ",
  "কর্মচারীর বেতন",
  "যন্ত্রাংশ ক্রয়",
  "অন্যান্য খরচ",
];

export function parseExpenseCategories(raw?: string | null): string[] {
  if (!raw) return [...DEFAULT_EXPENSE_CATEGORIES];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const cleaned = parsed.map((s) => String(s).trim()).filter(Boolean);
      return cleaned.length > 0 ? cleaned : [...DEFAULT_EXPENSE_CATEGORIES];
    }
  } catch {}
  return [...DEFAULT_EXPENSE_CATEGORIES];
}

export interface RentedMillSettingsData {
  id: number;
  millName: string;
  millAddress: string;
  millPhone: string;
  monthlyRent: number;
  partner1Name: string;
  partner1Share: number;
  partner2Name: string;
  partner2Share: number;
  defaultMillingRate: number;
  dryerNames?: string;
  expenseCategories?: string;
  accountantUserId: string | null;
  partnerUserId: string | null;
}

export const DEFAULT_RENTED_MILL_SETTINGS: RentedMillSettingsData = {
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
  dryerNames: JSON.stringify(DEFAULT_DRYER_NAMES),
  expenseCategories: JSON.stringify(DEFAULT_EXPENSE_CATEGORIES),
  accountantUserId: null,
  partnerUserId: null,
};

export const EXPENSE_CATEGORIES = DEFAULT_EXPENSE_CATEGORIES;

export interface SettlementResult {
  totalMillingRevenue: number;
  totalMillingCash: number;
  totalMillingDue: number;
  totalByproductRevenue: number;
  totalByproductCash: number;
  totalByproductDue: number;
  totalIncome: number;
  totalCashReceived: number;
  totalExpenses: number;
  netProfit: number;
  partner1ShareAmount: number;
  partner2ShareAmount: number;
  expensesByCategory: Record<string, number>;
  totalPaddyBags: number;
  totalByproductKg: number;
}

export interface RentedMillSettlementRecord {
  id: string;
  settlementNo: string;
  fromDate: Date | string;
  toDate: Date | string;
  totalMillingIncome: number;
  totalByproductIncome: number;
  totalIncome: number;
  totalRentExpense: number;
  totalOtherExpense: number;
  totalExpense: number;
  netProfit: number;
  partner1Name: string;
  partner1Share: number;
  partner1Amount: number;
  partner2Name: string;
  partner2Share: number;
  partner2Amount: number;
  status: string;
  notes: string | null;
  settledByName: string;
  settledByUserId: string | null;
  createdAt: Date | string;
}

export function calculateSettlement(
  bills: Array<{ totalAmount: number; paidAmount: number; dueAmount: number; paddyQuantity: number; unit: string }>,
  payments: Array<{ amount: number }>,
  byproducts: Array<{ totalAmount: number; paidAmount: number; dueAmount: number; quantity: number }>,
  expenses: Array<{ amount: number; category: string }>,
  settings: RentedMillSettingsData,
  paddyReceipts?: Array<{ totalBillAmount?: number; bagsCount?: number; standardBags75kg?: number }>
): SettlementResult {
  const receiptMillingRevenue = (paddyReceipts || []).reduce((acc, r) => acc + (r.totalBillAmount || 0), 0);
  const totalMillingRevenue = bills.reduce((acc, b) => acc + (b.totalAmount || 0), 0) + receiptMillingRevenue;
  const billInitialCash = bills.reduce((acc, b) => acc + (b.paidAmount || 0), 0);
  const subsequentPayments = payments.reduce((acc, p) => acc + (p.amount || 0), 0);
  const totalMillingCash = billInitialCash + subsequentPayments;
  const totalMillingDue = Math.max(0, totalMillingRevenue - totalMillingCash);

  const totalByproductRevenue = byproducts.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
  const totalByproductCash = byproducts.reduce((acc, s) => acc + (s.paidAmount || 0), 0);
  const totalByproductDue = Math.max(0, totalByproductRevenue - totalByproductCash);

  const totalIncome = totalMillingRevenue + totalByproductRevenue;
  const totalCashReceived = totalMillingCash + totalByproductCash;

  const expensesByCategory: Record<string, number> = {};
  for (const cat of EXPENSE_CATEGORIES) {
    expensesByCategory[cat] = 0;
  }

  let totalExpenses = 0;
  for (const exp of expenses) {
    const amt = exp.amount || 0;
    totalExpenses += amt;
    const cat = exp.category || "অন্যান্য খরচ";
    expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amt;
  }

  const netProfit = totalIncome - totalExpenses;
  const partner1ShareAmount = (netProfit * (settings.partner1Share || 50)) / 100;
  const partner2ShareAmount = (netProfit * (settings.partner2Share || 50)) / 100;

  const receiptBags = (paddyReceipts || []).reduce((acc, r) => acc + (r.bagsCount || 0), 0);
  const billBags = bills.reduce((acc, b) => {
    if (b.unit === "বস্তা") return acc + (b.paddyQuantity || 0);
    return acc;
  }, 0);
  const totalPaddyBags = billBags + receiptBags;

  const totalByproductKg = byproducts.reduce((acc, s) => acc + (s.quantity || 0), 0);

  return {
    totalMillingRevenue,
    totalMillingCash,
    totalMillingDue,
    totalByproductRevenue,
    totalByproductCash,
    totalByproductDue,
    totalIncome,
    totalCashReceived,
    totalExpenses,
    netProfit,
    partner1ShareAmount,
    partner2ShareAmount,
    expensesByCategory,
    totalPaddyBags,
    totalByproductKg,
  };
}

export type FundPartyType = "BANK" | "OWNER_1" | "OWNER_2";
export type FundTransactionType = "DEPOSIT" | "WITHDRAW";
export type FundMedium = "CASH" | "BANK";

export interface RentedMillBankAccountData {
  id: string;
  bankName: string;
  accountName: string | null;
  accountNumber: string;
  branchName: string | null;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  notes: string | null;
  createdAt: Date | string;
}

export interface RentedMillFundTransactionData {
  id: string;
  transactionNo: string;
  date: Date | string;
  partyType: FundPartyType;
  partnerName: string | null;
  transactionType: FundTransactionType;
  medium: FundMedium;
  bankAccountId: string | null;
  bankAccount?: {
    id: string;
    bankName: string;
    accountNumber: string;
    branchName?: string | null;
  } | null;
  amount: number;
  reference: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectedReason?: string | null;
  createdByName: string;
  createdByUserId?: string | null;
  approvedByName?: string | null;
  approvedByUserId?: string | null;
  approvedAt?: Date | string | null;
  createdAt: Date | string;
}

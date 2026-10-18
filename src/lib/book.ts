// Accounting books. The depot (business type DEPOT) keeps its own book: depot stock in, DO / market-sale
// challans, market collection, company payments and commission live in the DEPOT book and never reach the
// business's GENERAL sales, purchases, P&L, balance sheet, cash book, day book or ledgers. Each voucher
// balances on its own, so each book is a complete, balanced set of accounts.
import type { VoucherTypeKey } from "./accounting";

export type BookKey = "GENERAL" | "DEPOT";
/** "ALL": physical / integrity checks that must see both books */
export type BookFilter = BookKey | "ALL";

export const BOOK_LABELS: Record<BookKey, string> = { GENERAL: "সাধারণ হিসাব", DEPOT: "ডিপো হিসাব" };

/** Prisma where fragment on Voucher / JournalEntry. */
export const bookWhere = (b: BookFilter = "GENERAL") => (b === "ALL" ? {} : { book: b });

export const isBook = (v: unknown): v is BookKey => v === "GENERAL" || v === "DEPOT";

/** Depot vouchers are numbered in their own series (the general series stays gap-free). */
export const DEPOT_PREFIX: Partial<Record<VoucherTypeKey, string>> = {
  SALES: "MS", // market sale
  SALES_RETURN: "MSR",
  PURCHASE: "SI", // stock in from the company
  PURCHASE_RETURN: "SIR",
  RECEIPT: "MC", // market collection
  PAYMENT: "DP", // depot payment (to the company)
  JOURNAL: "DJ",
  STOCK_JOURNAL: "DSA", // depot stock adjustment
  OPENING: "DOB",
};

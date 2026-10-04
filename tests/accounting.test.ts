import { describe, expect, it } from "vitest";
import {
  assertBalanced,
  InvalidEntryError,
  journalLinesFromInput,
  naturalBalance,
  normalizeEntries,
  openingEntries,
  paymentEntries,
  prepareEntries,
  purchaseEntries,
  purchaseReturnEntries,
  receiptEntries,
  salesEntries,
  salesReturnEntries,
  stockJournalEntries,
  totals,
  UnbalancedVoucherError,
  unitConversionFactor,
  voucherPermissionFamily,
  voucherTypeFromSlug,
  type EntryLine,
  type SystemAccounts,
  type TradeInput,
} from "@/lib/accounting";

const ACC: SystemAccounts = {
  CASH: "cash", INVENTORY: "inv", VAT_PAYABLE: "vat", OPENING_EQUITY: "obe", SALES: "sales",
  SALES_RETURN: "sret", COGS: "cogs", DISCOUNT_ALLOWED: "disc", STOCK_ADJUSTMENT: "adj",
};

const net = (lines: EntryLine[], account: string) =>
  Math.round(lines.filter((l) => l.accountId === account).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100;

/** THE invariant, applied to every rule below. */
function expectBalanced(lines: EntryLine[]) {
  const p = prepareEntries(lines, { allowEmpty: true });
  const t = totals(p);
  expect(t.debit).toBe(t.credit);
  return p;
}

const trade = (o: Partial<TradeInput> = {}): TradeInput => ({
  partyAccountId: "cust", payments: [{ accountId: "cash", amount: 1_000 }], subtotal: 3_000, discount: 100, vatAmount: 145, total: 3_045, cost: 2_500, ...o,
});

describe("balance rule: total debit = total credit", () => {
  it("accepts a balanced voucher", () => {
    expect(assertBalanced([{ accountId: "a", debit: 100, credit: 0 }, { accountId: "b", debit: 0, credit: 100 }])).toEqual({ debit: 100, credit: 100 });
  });

  it("rejects an unbalanced voucher", () => {
    expect(() => assertBalanced([{ accountId: "a", debit: 100, credit: 0 }, { accountId: "b", debit: 0, credit: 99.99 }])).toThrow(UnbalancedVoucherError);
  });

  it("is exact to the paisa despite floating point", () => {
    const lines = [{ accountId: "a", debit: 0.1, credit: 0 }, { accountId: "b", debit: 0.2, credit: 0 }, { accountId: "c", debit: 0, credit: 0.3 }];
    expect(() => prepareEntries(lines)).not.toThrow();
  });

  it("rejects negative amounts, two-sided lines and missing accounts", () => {
    expect(() => normalizeEntries([{ accountId: "a", debit: -5, credit: 0 }])).toThrow(InvalidEntryError);
    expect(() => normalizeEntries([{ accountId: "a", debit: 5, credit: 5 }])).toThrow(InvalidEntryError);
    expect(() => normalizeEntries([{ accountId: "", debit: 5, credit: 0 }])).toThrow(InvalidEntryError);
  });

  it("drops zero lines and requires at least two lines", () => {
    expect(normalizeEntries([{ accountId: "a", debit: 0, credit: 0 }])).toEqual([]);
    expect(() => prepareEntries([{ accountId: "a", debit: 0, credit: 0 }])).toThrow(InvalidEntryError);
  });
});

describe("sales posting", () => {
  it("credits sales & VAT, debits party, discount and COGS, records receipt", () => {
    const l = expectBalanced(salesEntries(trade(), ACC));
    expect(net(l, "sales")).toBe(-3_000);
    expect(net(l, "vat")).toBe(-145);
    expect(net(l, "disc")).toBe(100);
    expect(net(l, "cogs")).toBe(2_500);
    expect(net(l, "inv")).toBe(-2_500);
    expect(net(l, "cust")).toBe(2_045); // 3,045 billed − 1,000 received
    expect(net(l, "cash")).toBe(1_000);
  });

  it("split payment: each cash/bank ledger is debited, the party credited once", () => {
    const l = expectBalanced(salesEntries(trade({ payments: [{ accountId: "cash", amount: 600 }, { accountId: "bkash", amount: 400 }] }), ACC));
    expect(net(l, "cash")).toBe(600);
    expect(net(l, "bkash")).toBe(400);
    expect(net(l, "cust")).toBe(2_045);
  });

  it("walk-in sale goes straight to cash and must be fully paid", () => {
    const l = expectBalanced(salesEntries(trade({ partyAccountId: null, payments: [{ accountId: "cash", amount: 3045 }] }), ACC));
    expect(net(l, "cash")).toBe(3_045);
    expect(() => salesEntries(trade({ partyAccountId: null, payments: [] }), ACC)).toThrow(InvalidEntryError);
  });

  it("rejects payment above the bill", () => {
    expect(() => salesEntries(trade({ payments: [{ accountId: "cash", amount: 5000 }] }), ACC)).toThrow(InvalidEntryError);
  });
});

describe("purchase posting", () => {
  it("debits inventory, credits supplier, records payment", () => {
    const l = expectBalanced(purchaseEntries(trade({ partyAccountId: "sup", total: 5_000, subtotal: 5_000, discount: 0, vatAmount: 0, payments: [{ accountId: "cash", amount: 2000 }], cost: 5_000 }), ACC));
    expect(net(l, "inv")).toBe(5_000);
    expect(net(l, "sup")).toBe(-3_000);
    expect(net(l, "cash")).toBe(-2_000);
  });
});

describe("returns", () => {
  it("sales return reverses revenue and cost", () => {
    const l = expectBalanced(salesReturnEntries(trade({ total: 300, payments: [], cost: 250 }), ACC));
    expect(net(l, "sret")).toBe(300);
    expect(net(l, "cust")).toBe(-300);
    expect(net(l, "inv")).toBe(250);
    expect(net(l, "cogs")).toBe(-250);
  });

  it("sales return with cash refund", () => {
    const l = expectBalanced(salesReturnEntries(trade({ total: 300, payments: [{ accountId: "cash", amount: 300 }], cost: 250 }), ACC));
    expect(net(l, "cust")).toBe(0);
    expect(net(l, "cash")).toBe(-300);
  });

  it("purchase return books the difference between return value and average cost", () => {
    const above = expectBalanced(purchaseReturnEntries(trade({ partyAccountId: "sup", total: 550, payments: [], cost: 500 }), ACC));
    expect(net(above, "sup")).toBe(550);
    expect(net(above, "inv")).toBe(-500);
    expect(net(above, "cogs")).toBe(-50);
    const below = expectBalanced(purchaseReturnEntries(trade({ partyAccountId: "sup", total: 450, payments: [], cost: 500 }), ACC));
    expect(net(below, "cogs")).toBe(50);
  });
});

describe("receipt, payment, journal, stock journal, opening", () => {
  it("receipt debits cash with the sum of the lines", () => {
    const l = expectBalanced(receiptEntries("cash", [{ accountId: "cust", amount: 500 }, { accountId: "income", amount: 200 }]));
    expect(net(l, "cash")).toBe(700);
    expect(net(l, "cust")).toBe(-500);
  });

  it("payment credits cash with the sum of the lines", () => {
    const l = expectBalanced(paymentEntries("bank", [{ accountId: "sup", amount: 1_000 }, { accountId: "rent", amount: 300 }]));
    expect(net(l, "bank")).toBe(-1_300);
    expect(net(l, "rent")).toBe(300);
  });

  it("journal lines pass through and must balance", () => {
    expect(() => prepareEntries(journalLinesFromInput([{ accountId: "a", debit: 10, credit: 0 }, { accountId: "b", debit: 0, credit: 9 }]))).toThrow(UnbalancedVoucherError);
  });

  it("stock journal posts only the value difference", () => {
    expect(stockJournalEntries(500, 500, ACC)).toEqual([]);
    const loss = expectBalanced(stockJournalEntries(0, 100, ACC));
    expect(net(loss, "adj")).toBe(100);
    expect(net(loss, "inv")).toBe(-100);
    const gain = expectBalanced(stockJournalEntries(80, 0, ACC));
    expect(net(gain, "inv")).toBe(80);
  });

  it("opening balances offset against opening-balance equity", () => {
    const dr = expectBalanced(openingEntries("cust", 1_000, ACC));
    expect(net(dr, "obe")).toBe(-1_000);
    const crb = expectBalanced(openingEntries("sup", -2_000, ACC));
    expect(net(crb, "sup")).toBe(-2_000);
    expect(openingEntries("x", 0, ACC)).toEqual([]);
  });
});

describe("helpers", () => {
  it("natural balance follows account nature", () => {
    expect(naturalBalance("ASSET", 100)).toBe(100);
    expect(naturalBalance("LIABILITY", -100)).toBe(100);
    expect(naturalBalance("INCOME", -250)).toBe(250);
    expect(naturalBalance("EXPENSE", 40)).toBe(40);
  });

  it("converts alternative units to the product's base unit", () => {
    const kg = { id: "kg", baseUnitId: null, factor: 1 };
    const bag = { id: "bag", baseUnitId: "kg", factor: 50 };
    const gram = { id: "g", baseUnitId: "kg", factor: 0.001 };
    const pcs = { id: "pcs", baseUnitId: null, factor: 1 };
    expect(unitConversionFactor(bag, kg)).toBe(50);
    expect(unitConversionFactor(gram, kg)).toBe(0.001);
    expect(unitConversionFactor(bag, gram)).toBe(50_000);
    expect(unitConversionFactor(pcs, kg)).toBeNull();
  });

  it("maps slugs and permission families", () => {
    expect(voucherTypeFromSlug("sales-return")).toBe("SALES_RETURN");
    expect(voucherTypeFromSlug("opening")).toBeNull();
    expect(voucherPermissionFamily("PURCHASE_RETURN")).toBe("purchases");
    expect(voucherPermissionFamily("JOURNAL")).toBe("vouchers");
    expect(voucherPermissionFamily("STOCK_JOURNAL")).toBe("stock");
  });
});

"use server";

import { prisma } from "@/lib/db";
import { requireContext } from "../auth";
import { ci } from "@/lib/dialect";
import { digitVariants, toAsciiDigits } from "@/lib/digits";
import { balancesBefore } from "../services/ledger";
import { VOUCHER_TYPES, type VoucherTypeKey } from "@/lib/accounting";
import { formatDate, formatMoney } from "@/lib/format";
import { voucherScopeWhere, partyListWhere } from "../party-scope";
import type { Prisma } from "@prisma/client";

export interface GlobalVoucherHit {
  id: string;
  voucherNo: string;
  type: string;
  typeLabel: string;
  date: string;
  formattedDate: string;
  amount: number;
  formattedAmount: string;
  partyName: string | null;
  narration: string | null;
  reference: string | null;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "REJECTED";
  href: string;
}

export interface GlobalAccountHit {
  id: string;
  name: string;
  kind: "CUSTOMER" | "SUPPLIER" | "ACCOUNT";
  kindLabel: string;
  code: string | null;
  mobile: string | null;
  groupName: string | null;
  balance: number;
  formattedBalance: string;
  balanceLabel: string;
  balanceTone: "neutral" | "red" | "green";
  href: string;
}

export interface GlobalSearchResult {
  vouchers: GlobalVoucherHit[];
  accounts: GlobalAccountHit[];
}

export async function searchGlobalAction(query: string): Promise<GlobalSearchResult> {
  const raw = (query || "").trim();
  if (!raw || raw.length < 1) {
    return { vouchers: [], accounts: [] };
  }
  const ctx = await requireContext();

  const cur = ctx.business.currencySymbol || "৳";
  const asciiQuery = toAsciiDigits(raw);
  const digitsOnly = asciiQuery.replace(/\D/g, "");
  const variants = digitVariants(raw);

  // 1. Search Vouchers / Invoices / Deliveries
  const voucherWhere: Prisma.VoucherWhereInput = {
    businessId: ctx.business.id,
    type: { not: "OPENING" },
    ...voucherScopeWhere(ctx),
    OR: [
      { voucherNo: ci(raw) },
      { voucherNo: ci(asciiQuery) },
      { reference: ci(raw) },
      { reference: ci(asciiQuery) },
      { narration: ci(raw) },
      ...variants.map((v) => ({ partyAccount: { name: ci(v) } })),
      ...(digitsOnly.length >= 3
        ? [
            { partyAccount: { customer: { mobile: { contains: digitsOnly } } } },
            { partyAccount: { supplier: { mobile: { contains: digitsOnly } } } },
          ]
        : []),
    ],
  };

  // 2. Search Customers
  const customerWhere: Prisma.CustomerWhereInput = {
    businessId: ctx.business.id,
    isActive: true,
    ...partyListWhere(ctx, "CUSTOMER"),
    OR: [
      ...variants.map((v) => ({ name: ci(v) })),
      ...variants.map((v) => ({ ownerName: ci(v) })),
      { account: { code: ci(asciiQuery) } },
      ...(digitsOnly.length >= 3 ? [{ mobile: { contains: digitsOnly } }] : []),
    ],
  };

  // 3. Search Suppliers
  const supplierWhere: Prisma.SupplierWhereInput = {
    businessId: ctx.business.id,
    isActive: true,
    ...partyListWhere(ctx, "SUPPLIER"),
    OR: [
      ...variants.map((v) => ({ name: ci(v) })),
      { account: { code: ci(asciiQuery) } },
      ...(digitsOnly.length >= 3 ? [{ mobile: { contains: digitsOnly } }] : []),
    ],
  };

  // 4. Search General Accounts (Cash, Bank, Expenses, Assets, Income, etc.)
  const accountWhere: Prisma.AccountWhereInput = {
    businessId: ctx.business.id,
    isActive: true,
    kind: { notIn: ["CUSTOMER", "SUPPLIER"] },
    OR: [
      ...variants.map((v) => ({ name: ci(v) })),
      { code: ci(asciiQuery) },
      { bankName: ci(raw) },
      { accountNumber: ci(asciiQuery) },
    ],
  };

  const [rawVouchers, customers, suppliers, generalAccounts] = await Promise.all([
    prisma.voucher.findMany({
      where: voucherWhere,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: {
        id: true,
        voucherNo: true,
        type: true,
        date: true,
        amount: true,
        narration: true,
        reference: true,
        verificationStatus: true,
        partyAccount: { select: { id: true, name: true } },
        depotDelivery: { select: { id: true } },
      },
    }),
    prisma.customer.findMany({
      where: customerWhere,
      take: 6,
      select: {
        id: true,
        name: true,
        mobile: true,
        groupName: true,
        accountId: true,
        account: { select: { code: true, group: { select: { name: true } } } },
      },
    }),
    prisma.supplier.findMany({
      where: supplierWhere,
      take: 6,
      select: {
        id: true,
        name: true,
        mobile: true,
        accountId: true,
        account: { select: { code: true, group: { select: { name: true } } } },
      },
    }),
    prisma.account.findMany({
      where: accountWhere,
      take: 4,
      select: {
        id: true,
        name: true,
        code: true,
        kind: true,
        group: { select: { name: true } },
      },
    }),
  ]);

  // Compute balances for matched parties and accounts
  const allAccountIds = [
    ...customers.map((c) => c.accountId),
    ...suppliers.map((s) => s.accountId),
    ...generalAccounts.map((a) => a.id),
  ];

  const balances = allAccountIds.length
    ? await balancesBefore(ctx.business.id, undefined, allAccountIds)
    : new Map<string, number>();

  // Format voucher hits
  const vouchers: GlobalVoucherHit[] = rawVouchers.map((v) => {
    const rawStatus = (v.verificationStatus || "UNVERIFIED") as string;
    const verificationStatus = (rawStatus === "VERIFIED" || rawStatus === "REJECTED" ? rawStatus : "UNVERIFIED") as "UNVERIFIED" | "VERIFIED" | "REJECTED";
    const typeLabel = VOUCHER_TYPES[v.type as VoucherTypeKey]?.label ?? v.type;
    const isChallan = Boolean(v.depotDelivery || v.type === "DEPOT_DELIVERY");
    const href = isChallan ? `/depot/deliveries/${v.id}` : `/vouchers/v/${v.id}`;
    const numAmount = Number(v.amount) || 0;

    return {
      id: v.id,
      voucherNo: v.voucherNo,
      type: v.type,
      typeLabel,
      date: v.date.toISOString(),
      formattedDate: formatDate(v.date),
      amount: numAmount,
      formattedAmount: formatMoney(numAmount, cur),
      partyName: v.partyAccount?.name ?? null,
      narration: v.narration,
      reference: v.reference,
      verificationStatus,
      href,
    };
  });

  // Format account hits
  const accounts: GlobalAccountHit[] = [];

  // Customers
  for (const c of customers) {
    const bal = balances.get(c.accountId) ?? 0;
    // For customers, positive balance is receivable (পাওনা), negative is advance (জমা)
    const formattedBalance = formatMoney(Math.abs(bal), cur);
    const balanceLabel = bal > 0 ? `পাওনা: ${formattedBalance}` : bal < 0 ? `জমা: ${formattedBalance}` : "পরিশোধিত";
    const balanceTone: "neutral" | "red" | "green" = bal > 0 ? "red" : bal < 0 ? "green" : "neutral";

    accounts.push({
      id: c.id,
      name: c.name,
      kind: "CUSTOMER",
      kindLabel: "কাস্টমার",
      code: c.account?.code ?? null,
      mobile: c.mobile,
      groupName: c.groupName ?? c.account?.group?.name ?? null,
      balance: bal,
      formattedBalance,
      balanceLabel,
      balanceTone,
      href: `/customers/${c.id}/ledger`,
    });
  }

  // Suppliers
  for (const s of suppliers) {
    const bal = balances.get(s.accountId) ?? 0;
    // For suppliers, negative balance in ledger (Dr - Cr) means payable (দেনা), or we check natural balance
    // Ledger balance = debit - credit. For supplier: credit > debit means we owe supplier (payable).
    // bal < 0 means supplier payable (দেনা).
    const isPayable = bal < 0;
    const isReceivable = bal > 0;
    const formattedBalance = formatMoney(Math.abs(bal), cur);
    const balanceLabel = isPayable ? `দেনা: ${formattedBalance}` : isReceivable ? `অগ্রিম: ${formattedBalance}` : "পরিশোধিত";
    const balanceTone: "neutral" | "red" | "green" = isPayable ? "red" : isReceivable ? "green" : "neutral";

    accounts.push({
      id: s.id,
      name: s.name,
      kind: "SUPPLIER",
      kindLabel: "সরবরাহকারী",
      code: s.account?.code ?? null,
      mobile: s.mobile,
      groupName: s.account?.group?.name ?? null,
      balance: bal,
      formattedBalance,
      balanceLabel,
      balanceTone,
      href: `/suppliers/${s.id}/ledger`,
    });
  }

  // General Accounts
  for (const a of generalAccounts) {
    const bal = balances.get(a.id) ?? 0;
    const formattedBalance = formatMoney(Math.abs(bal), cur);
    const kindLabel = a.kind === "CASH" ? "নগদ তহবিল" : a.kind === "BANK" ? "ব্যাংক হিসাব" : a.group?.name ?? "সাধারণ হিসাব";

    accounts.push({
      id: a.id,
      name: a.name,
      kind: "ACCOUNT",
      kindLabel,
      code: a.code,
      mobile: null,
      groupName: a.group?.name ?? null,
      balance: bal,
      formattedBalance,
      balanceLabel: formattedBalance,
      balanceTone: "neutral",
      href: `/accounts/${a.id}`,
    });
  }

  return { vouchers, accounts };
}

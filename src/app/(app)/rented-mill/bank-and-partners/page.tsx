import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";
import {
  getRentedMillSettings,
  resolveRentedMillRole,
} from "@/lib/rented-mill";
import { toBn } from "@/lib/format";
import { RentedMillTabs } from "../rented-mill-ui";
import { BankPartnersClient } from "./bank-partners-client";
import type {
  RentedMillBankAccountData,
  RentedMillFundTransactionData,
} from "@/lib/rented-mill-types";

export const metadata: Metadata = {
  title: "ব্যাংক ও মালিকদের মূলধন হিসাব - শুভংকর অটো রাইস মিল",
};

export default async function BankAndPartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const ctx = await requireContext();
  const settings = await getRentedMillSettings();
  const role = resolveRentedMillRole(ctx, settings);

  const sp = await searchParams;
  const range = sp.range || "month";

  const now = new Date();
  let dateFilter: { gte?: Date; lte?: Date } | undefined;
  let rangeLabel = "চলতি মাস";

  if (range === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    dateFilter = { gte: start, lte: end };
    rangeLabel = "আজকের হিসাব";
  } else if (range === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    dateFilter = { gte: start, lte: end };
    rangeLabel = `${now.toLocaleString("bn-BD", { month: "long" })} ${toBn(now.getFullYear())}`;
  } else if (range === "last-month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    dateFilter = { gte: start, lte: end };
    rangeLabel = "গত মাস";
  } else if (range === "custom" && (sp.from || sp.to)) {
    const gte = sp.from ? new Date(`${sp.from}T00:00:00`) : undefined;
    const lte = sp.to ? new Date(`${sp.to}T23:59:59`) : undefined;
    dateFilter = { gte, lte };
    rangeLabel = `${sp.from ? toBn(sp.from) : ""} হতে ${sp.to ? toBn(sp.to) : ""}`;
  } else if (range === "all") {
    dateFilter = undefined;
    rangeLabel = "সব সময়ের সার্বিক হিসাব";
  }

  // Ensure at least one default bank account exists
  const existingBanksCount = await prisma.rentedMillBankAccount.count();
  if (existingBanksCount === 0) {
    await prisma.rentedMillBankAccount.create({
      data: {
        bankName: "সোনালী ব্যাংক পিএলসি",
        accountName: settings.millName,
        accountNumber: "০১২৩৪৫৬৭৮৯",
        branchName: "দিনাজপুর শাখা",
        openingBalance: 0,
        currentBalance: 0,
        isActive: true,
      },
    });
  }

  // Fetch active bank accounts
  const bankAccountsRaw = await prisma.rentedMillBankAccount.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const bankAccounts: RentedMillBankAccountData[] = bankAccountsRaw.map((b) => ({
    id: b.id,
    bankName: b.bankName,
    accountName: b.accountName,
    accountNumber: b.accountNumber,
    branchName: b.branchName,
    openingBalance: b.openingBalance,
    currentBalance: b.currentBalance,
    isActive: b.isActive,
    notes: b.notes,
    createdAt: b.createdAt,
  }));

  // Fetch fund transactions in date range (only APPROVED)
  const txsRaw = await prisma.rentedMillFundTransaction.findMany({
    where: {
      ...(dateFilter ? { date: dateFilter } : {}),
      status: "APPROVED",
    },
    include: {
      bankAccount: {
        select: {
          id: true,
          bankName: true,
          accountNumber: true,
          branchName: true,
        },
      },
    },
    orderBy: { date: "desc" },
  });

  const transactions: RentedMillFundTransactionData[] = txsRaw.map((t) => ({
    id: t.id,
    transactionNo: t.transactionNo,
    date: t.date,
    partyType: t.partyType as any,
    partnerName: t.partnerName,
    transactionType: t.transactionType as any,
    medium: t.medium as any,
    bankAccountId: t.bankAccountId,
    bankAccount: t.bankAccount,
    amount: t.amount,
    reference: t.reference,
    status: t.status as any,
    rejectedReason: t.rejectedReason,
    createdByName: t.createdByName,
    createdByUserId: t.createdByUserId,
    approvedByName: t.approvedByName,
    approvedByUserId: t.approvedByUserId,
    approvedAt: t.approvedAt,
    createdAt: t.createdAt,
  }));

  return (
    <div className="space-y-6">
      <RentedMillTabs role={role} />

      <BankPartnersClient
        role={role}
        settings={settings}
        bankAccounts={bankAccounts}
        transactions={transactions}
        range={range}
        rangeLabel={rangeLabel}
        dateFilter={sp.from || sp.to ? { from: sp.from, to: sp.to } : undefined}
      />
    </div>
  );
}

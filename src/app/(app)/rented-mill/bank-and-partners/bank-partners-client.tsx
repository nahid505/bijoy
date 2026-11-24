"use client";

import { useState } from "react";
import Link from "next/link";
import {
  type RentedMillRole,
  type RentedMillSettingsData,
  type RentedMillBankAccountData,
  type RentedMillFundTransactionData,
} from "@/lib/rented-mill-types";
import { formatBnCurrency, getBengaliDateLabel, toBn } from "@/lib/format";
import {
  FundTransactionModal,
  BankAccountModal,
  EditFundTransactionModal,
  type FundModalType,
} from "../fund-transaction-modals";
import { PrintButton } from "../rented-mill-ui";

export function BankPartnersClient({
  role,
  settings,
  bankAccounts,
  transactions,
  range,
  rangeLabel,
  dateFilter,
}: {
  role: RentedMillRole;
  settings: RentedMillSettingsData;
  bankAccounts: RentedMillBankAccountData[];
  transactions: RentedMillFundTransactionData[];
  range: string;
  rangeLabel: string;
  dateFilter?: { from?: string; to?: string };
}) {
  const [activeTab, setActiveTab] = useState<"BANK" | "OWNER_1" | "OWNER_2">("BANK");
  const [fundModalType, setFundModalType] = useState<FundModalType>(null);
  const [showBankModal, setShowBankModal] = useState(false);
  const [editingBankAccount, setEditingBankAccount] = useState<RentedMillBankAccountData | null>(null);
  const [editingTransaction, setEditingTransaction] = useState<RentedMillFundTransactionData | null>(null);

  // Filter bank transactions
  const bankTxs = transactions.filter(
    (t) =>
      t.partyType === "BANK" ||
      ((t.partyType === "OWNER_1" || t.partyType === "OWNER_2") && t.medium === "BANK")
  );

  // Filter Partner 1 transactions
  const p1Txs = transactions.filter((t) => t.partyType === "OWNER_1");

  // Filter Partner 2 transactions
  const p2Txs = transactions.filter((t) => t.partyType === "OWNER_2");

  // Bank calculations
  const totalBankBalance = bankAccounts.reduce((s, b) => s + (b.currentBalance || 0), 0);
  const totalBankDeposits = bankTxs
    .filter((t) => {
      if (t.partyType === "BANK") return t.transactionType === "DEPOSIT";
      return t.medium === "BANK" && t.transactionType === "DEPOSIT";
    })
    .reduce((s, t) => s + t.amount, 0);

  const totalBankWithdrawals = bankTxs
    .filter((t) => {
      if (t.partyType === "BANK") return t.transactionType === "WITHDRAW";
      return t.medium === "BANK" && t.transactionType === "WITHDRAW";
    })
    .reduce((s, t) => s + t.amount, 0);

  // Partner 1 calculations
  const p1Deposits = p1Txs
    .filter((t) => t.transactionType === "DEPOSIT")
    .reduce((s, t) => s + t.amount, 0);
  const p1Withdrawals = p1Txs
    .filter((t) => t.transactionType === "WITHDRAW")
    .reduce((s, t) => s + t.amount, 0);
  const p1Net = p1Deposits - p1Withdrawals;

  // Partner 2 calculations
  const p2Deposits = p2Txs
    .filter((t) => t.transactionType === "DEPOSIT")
    .reduce((s, t) => s + t.amount, 0);
  const p2Withdrawals = p2Txs
    .filter((t) => t.transactionType === "WITHDRAW")
    .reduce((s, t) => s + t.amount, 0);
  const p2Net = p2Deposits - p2Withdrawals;

  return (
    <div className="space-y-6">
      {/* Modals */}
      <FundTransactionModal
        isOpen={fundModalType !== null}
        onClose={() => setFundModalType(null)}
        modalType={fundModalType}
        partner1Name={settings.partner1Name}
        partner2Name={settings.partner2Name}
        bankAccounts={bankAccounts}
      />

      <BankAccountModal
        isOpen={showBankModal}
        onClose={() => {
          setShowBankModal(false);
          setEditingBankAccount(null);
        }}
        initialData={editingBankAccount}
      />

      <EditFundTransactionModal
        isOpen={editingTransaction !== null}
        onClose={() => setEditingTransaction(null)}
        transaction={editingTransaction}
        bankAccounts={bankAccounts}
      />

      {/* Header & Date Filter Bar */}
      <div className="no-print flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-rule pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-ink-900">
              🏦 ব্যাংক ও মালিকদের মূলধন হিসাব
            </h1>
            <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
              স্বতন্ত্র তহবিল
            </span>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-slate-500">
            {settings.millName} · মিলের ব্যাংক লেনদেন এবং দুই মালিকের মূলধন জমা ও উত্তোলনের খতিয়ান
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Date Filters */}
          <div className="flex rounded-lg border border-rule bg-white p-1 text-xs shadow-2xs">
            <Link
              href="/rented-mill/bank-and-partners?range=month"
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "month" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              চলতি মাস
            </Link>
            <Link
              href="/rented-mill/bank-and-partners?range=today"
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "today" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              আজ
            </Link>
            <Link
              href="/rented-mill/bank-and-partners?range=last-month"
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "last-month" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              গত মাস
            </Link>
            <Link
              href="/rented-mill/bank-and-partners?range=all"
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                range === "all" ? "bg-brand-600 text-white" : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              সব সময়
            </Link>
          </div>
          <PrintButton label="স্টেটমেন্ট প্রিন্ট" />
        </div>
      </div>

      {/* Print Statement Header (Visible only when printed) */}
      <div className="hidden print:block text-center border-b pb-3 mb-4">
        <h2 className="text-2xl font-bold">{settings.millName}</h2>
        <p className="text-xs text-slate-600">{settings.millAddress} · {settings.millPhone}</p>
        <p className="text-sm font-semibold mt-1">
          ব্যাংক হিসাব ও মালিকদের মূলধন/তহবিল স্টেটমেন্ট ({rangeLabel})
        </p>
        <p className="text-xs text-slate-500">প্রিন্ট তারিখ: {getBengaliDateLabel(new Date())}</p>
      </div>

      {/* 3 Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: মিলের ব্যাংক ব্যালেন্স */}
        <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/70 to-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-900 text-xl">
              🏦
            </span>
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold text-blue-800">
              ব্যাংক স্থিতি
            </span>
          </div>
          <p className="text-xs font-semibold text-slate-600 mt-3">মিলের সর্বমোট ব্যাংক ব্যালেন্স</p>
          <p className="text-2xl font-black text-blue-950 mt-0.5">
            {formatBnCurrency(totalBankBalance)}
          </p>
          <div className="mt-2.5 pt-2 border-t border-blue-100 text-[11px] text-slate-600 space-y-0.5">
            {bankAccounts.map((b) => (
              <div key={b.id} className="flex justify-between">
                <span className="truncate">{b.bankName}:</span>
                <span className="font-bold text-blue-900">{formatBnCurrency(b.currentBalance)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Card 2: নাহিদ হাসান (মালিক ১) */}
        <div className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50/70 to-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 text-brand-900 text-xl">
              👤
            </span>
            <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-bold text-brand-800">
              মালিক ১ ({toBn(settings.partner1Share)}%)
            </span>
          </div>
          <p className="text-xs font-semibold text-slate-600 mt-3">{settings.partner1Name} (নিট মূলধন স্থিতি)</p>
          <p className={`text-2xl font-black mt-0.5 ${p1Net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {formatBnCurrency(p1Net)}
          </p>
          <div className="mt-2.5 pt-2 border-t border-brand-100 flex items-center justify-between text-[11px] text-slate-600">
            <span>মোট জমা: <b className="text-emerald-800 font-bold">{formatBnCurrency(p1Deposits)}</b></span>
            <span>উত্তোলন: <b className="text-rose-800 font-bold">{formatBnCurrency(p1Withdrawals)}</b></span>
          </div>
        </div>

        {/* Card 3: পার্টনার (মালিক ২) */}
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 to-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-900 text-xl">
              👥
            </span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
              মালিক ২ ({toBn(settings.partner2Share)}%)
            </span>
          </div>
          <p className="text-xs font-semibold text-slate-600 mt-3">{settings.partner2Name} (নিট মূলধন স্থিতি)</p>
          <p className={`text-2xl font-black mt-0.5 ${p2Net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
            {formatBnCurrency(p2Net)}
          </p>
          <div className="mt-2.5 pt-2 border-t border-emerald-100 flex items-center justify-between text-[11px] text-slate-600">
            <span>মোট জমা: <b className="text-emerald-800 font-bold">{formatBnCurrency(p2Deposits)}</b></span>
            <span>উত্তোলন: <b className="text-rose-800 font-bold">{formatBnCurrency(p2Withdrawals)}</b></span>
          </div>
        </div>
      </div>

      {/* Quick Action Buttons */}
      <div className="no-print rounded-2xl border border-rule bg-white p-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-ink-900 flex items-center gap-1.5">
              <span>⚡</span> দ্রুত তহবিল লেনদেন ও ব্যাংক হিসাব
            </h3>
            <p className="text-xs text-slate-500">
              ক্যাশ থেকে ব্যাংকে জমা, ব্যাংক থেকে উত্তোলন বা মালিকদের টাকা জমা ও উত্তোলনের নতুন এন্ট্রি দিন
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFundModalType("BANK_DEPOSIT")}
              className="inline-flex items-center gap-1 rounded-xl bg-blue-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-blue-800 transition"
            >
              <span>+</span> ব্যাংকে জমা
            </button>
            <button
              type="button"
              onClick={() => setFundModalType("BANK_WITHDRAW")}
              className="inline-flex items-center gap-1 rounded-xl bg-blue-100 border border-blue-300 px-3 py-1.5 text-xs font-bold text-blue-900 hover:bg-blue-200 transition"
            >
              <span>-</span> ব্যাংক উত্তোলন
            </button>
            <button
              type="button"
              onClick={() => setFundModalType("PARTNER_DEPOSIT")}
              className="inline-flex items-center gap-1 rounded-xl bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-emerald-800 transition"
            >
              <span>+</span> মালিকের টাকা জমা
            </button>
            <button
              type="button"
              onClick={() => setFundModalType("PARTNER_WITHDRAW")}
              className="inline-flex items-center gap-1 rounded-xl bg-rose-700 px-3 py-1.5 text-xs font-bold text-white shadow-2xs hover:bg-rose-800 transition"
            >
              <span>-</span> মালিকের টাকা উত্তোলন
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingBankAccount(null);
                setShowBankModal(true);
              }}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-ink-800 hover:bg-slate-50 transition"
            >
              <span>🏦</span> + নতুন ব্যাংক হিসাব
            </button>
          </div>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="no-print flex items-center border-b border-rule gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("BANK")}
          className={`py-2.5 px-4 text-xs sm:text-sm font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === "BANK"
              ? "border-blue-600 text-blue-700 bg-blue-50/50 rounded-t-xl"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>🏦</span> ব্যাংক হিসাব ও খতিয়ান ({toBn(bankTxs.length)})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("OWNER_1")}
          className={`py-2.5 px-4 text-xs sm:text-sm font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === "OWNER_1"
              ? "border-brand-600 text-brand-700 bg-brand-50/50 rounded-t-xl"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>👤</span> {settings.partner1Name} (মালিক ১) খতিয়ান ({toBn(p1Txs.length)})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("OWNER_2")}
          className={`py-2.5 px-4 text-xs sm:text-sm font-bold border-b-2 transition flex items-center gap-2 ${
            activeTab === "OWNER_2"
              ? "border-emerald-600 text-emerald-700 bg-emerald-50/50 rounded-t-xl"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <span>👥</span> {settings.partner2Name} (মালিক ২) খতিয়ান ({toBn(p2Txs.length)})
        </button>
      </div>

      {/* Tab 1: ব্যাংক হিসাব ও খতিয়ান */}
      {activeTab === "BANK" && (
        <div className="space-y-4">
          {/* Bank Accounts Sub-Cards */}
          <div className="no-print rounded-2xl border border-rule bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between border-b pb-2.5 mb-3">
              <h3 className="text-sm font-bold text-ink-900">
                মিলের ব্যাংক অ্যাকাউন্ট তালিকা ({toBn(bankAccounts.length)} টি)
              </h3>
              <button
                type="button"
                onClick={() => {
                  setEditingBankAccount(null);
                  setShowBankModal(true);
                }}
                className="text-xs text-blue-700 font-bold hover:underline"
              >
                + নতুন ব্যাংক যোগ করুন
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {bankAccounts.map((b) => (
                <div
                  key={b.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-ink-900 text-xs sm:text-sm">{b.bankName}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBankAccount(b);
                          setShowBankModal(true);
                        }}
                        className="text-[11px] text-brand-700 hover:underline font-semibold"
                      >
                        সম্পাদনা
                      </button>
                    </div>
                    <p className="text-xs font-mono text-slate-600 mt-1">হিসাব নং: {b.accountNumber}</p>
                    <p className="text-[11px] text-slate-500">{b.branchName || "শাখা"} · {b.accountName || ""}</p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between">
                    <span className="text-[11px] text-slate-600">বর্তমান ব্যালেন্স:</span>
                    <span className="text-sm font-black text-blue-900">
                      {formatBnCurrency(b.currentBalance)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bank Transactions Table */}
          <div className="rounded-2xl border border-rule bg-white p-4 shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-3 border-b gap-2">
              <div>
                <h3 className="text-sm sm:text-base font-bold text-ink-900">
                  ব্যাংক লেনদেন ও খতিয়ান স্টেটমেন্ট ({rangeLabel})
                </h3>
                <p className="text-xs text-slate-500">
                  ব্যাংকে জমা, ব্যাংক থেকে উত্তোলন ও মালিকদের ব্যাংক মাধ্যমে লেনদেন
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span>মোট জমা: <b className="text-emerald-800">{formatBnCurrency(totalBankDeposits)}</b></span>
                <span>মোট উত্তোলন: <b className="text-rose-800">{formatBnCurrency(totalBankWithdrawals)}</b></span>
              </div>
            </div>

            <div className="overflow-x-auto mt-3">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-3 font-semibold">ক্রমিক</th>
                    <th className="py-2.5 px-3 font-semibold">তারিখ</th>
                    <th className="py-2.5 px-3 font-semibold">ভাউচার নং</th>
                    <th className="py-2.5 px-3 font-semibold">ব্যাংক হিসাব</th>
                    <th className="py-2.5 px-3 font-semibold">লেনদেনের বিবরণ / ধরন</th>
                    <th className="py-2.5 px-3 font-semibold">মাধ্যম</th>
                    <th className="py-2.5 px-3 font-semibold">রেফারেন্স / নোট</th>
                    <th className="py-2.5 px-3 font-semibold text-right">জমা (৳)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">উত্তোলন (৳)</th>
                    <th className="py-2.5 px-3 font-semibold text-center no-print">অ্যাকশন</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bankTxs.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-slate-500">
                        এই সময়কালে কোনো ব্যাংক লেনদেন পাওয়া যায়নি।
                      </td>
                    </tr>
                  ) : (
                    bankTxs.map((t, i) => {
                      const isDeposit = t.transactionType === "DEPOSIT";
                      const typeLabel =
                        t.partyType === "BANK"
                          ? isDeposit
                            ? "ক্যাশ থেকে ব্যাংকে জমা"
                            : "ব্যাংক থেকে ক্যাশে উত্তোলন"
                          : `${t.partnerName || "মালিক"} (${isDeposit ? "ব্যাংকে মূলধন জমা" : "ব্যাংক থেকে উত্তোলন"})`;

                      return (
                        <tr key={t.id} className="hover:bg-slate-50/80">
                          <td className="py-2.5 px-3 text-slate-500 font-mono">{toBn(i + 1)}</td>
                          <td className="py-2.5 px-3 whitespace-nowrap">{getBengaliDateLabel(new Date(t.date))}</td>
                          <td className="py-2.5 px-3 font-mono font-bold text-ink-800">{t.transactionNo}</td>
                          <td className="py-2.5 px-3 font-medium text-ink-900">
                            {t.bankAccount ? `${t.bankAccount.bankName} (${t.bankAccount.accountNumber})` : "অনির্দিষ্ট ব্যাংক"}
                          </td>
                          <td className="py-2.5 px-3 font-semibold">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[11px] ${
                                isDeposit ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"
                              }`}
                            >
                              {typeLabel}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {t.medium === "CASH" ? "ক্যাশ / নগদ" : "ব্যাংক অ্যাকাউন্ট"}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">
                            {t.reference || "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                            {isDeposit ? formatBnCurrency(t.amount) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-rose-700">
                            {!isDeposit ? formatBnCurrency(t.amount) : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-center no-print">
                            <button
                              type="button"
                              onClick={() => setEditingTransaction(t)}
                              className="text-brand-700 hover:underline font-semibold"
                            >
                              সম্পাদনা
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 font-bold bg-slate-50 text-ink-900">
                    <td colSpan={7} className="py-3 px-3 text-right">
                      মেয়াদের মোট যোগফল:
                    </td>
                    <td className="py-3 px-3 text-right text-emerald-800 font-black">
                      {formatBnCurrency(totalBankDeposits)}
                    </td>
                    <td className="py-3 px-3 text-right text-rose-800 font-black">
                      {formatBnCurrency(totalBankWithdrawals)}
                    </td>
                    <td className="no-print" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: নাহিদ হাসান (মালিক ১) খতিয়ান */}
      {activeTab === "OWNER_1" && (
        <div className="space-y-4">
          <PartnerLedgerSection
            partnerName={settings.partner1Name}
            partnerRoleLabel="মালিক ১ (৫০%)"
            txs={p1Txs}
            totalDeposits={p1Deposits}
            totalWithdrawals={p1Withdrawals}
            netBalance={p1Net}
            rangeLabel={rangeLabel}
            onEdit={(t) => setEditingTransaction(t)}
          />
        </div>
      )}

      {/* Tab 3: পার্টনার (মালিক ২) খতিয়ান */}
      {activeTab === "OWNER_2" && (
        <div className="space-y-4">
          <PartnerLedgerSection
            partnerName={settings.partner2Name}
            partnerRoleLabel="মালিক ২ (৫০%)"
            txs={p2Txs}
            totalDeposits={p2Deposits}
            totalWithdrawals={p2Withdrawals}
            netBalance={p2Net}
            rangeLabel={rangeLabel}
            onEdit={(t) => setEditingTransaction(t)}
          />
        </div>
      )}

      {/* Print Signature Section */}
      <div className="hidden print:grid grid-cols-3 gap-8 pt-16 text-center text-xs text-slate-700">
        <div>
          <div className="border-t border-slate-400 pt-2 font-semibold">হিসাবরক্ষক</div>
          <p className="text-[11px] text-slate-500">স্বাক্ষর</p>
        </div>
        <div>
          <div className="border-t border-slate-400 pt-2 font-semibold">{settings.partner1Name} (মালিক ১)</div>
          <p className="text-[11px] text-slate-500">স্বাক্ষর</p>
        </div>
        <div>
          <div className="border-t border-slate-400 pt-2 font-semibold">{settings.partner2Name} (মালিক ২)</div>
          <p className="text-[11px] text-slate-500">স্বাক্ষর</p>
        </div>
      </div>
    </div>
  );
}

function PartnerLedgerSection({
  partnerName,
  partnerRoleLabel,
  txs,
  totalDeposits,
  totalWithdrawals,
  netBalance,
  rangeLabel,
  onEdit,
}: {
  partnerName: string;
  partnerRoleLabel: string;
  txs: RentedMillFundTransactionData[];
  totalDeposits: number;
  totalWithdrawals: number;
  netBalance: number;
  rangeLabel: string;
  onEdit: (t: RentedMillFundTransactionData) => void;
}) {
  return (
    <div className="rounded-2xl border border-rule bg-white p-4 sm:p-5 shadow-2xs">
      {/* Sub Header & Balance Card */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-bold text-ink-900">
              {partnerName} — মূলধন জমা ও উত্তোলন খতিয়ান
            </h3>
            <span className="rounded-full bg-brand-100 text-brand-900 px-2 py-0.5 text-xs font-bold">
              {partnerRoleLabel}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            মেয়াদ: <b>{rangeLabel}</b> · ব্যক্তিগত তহবিলের জমা-উত্তোলন হিসাব
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 border p-3 flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-500 block text-[11px]">মেয়াদে মোট জমা:</span>
            <b className="text-emerald-800 text-sm font-bold">{formatBnCurrency(totalDeposits)}</b>
          </div>
          <div className="border-l pl-3">
            <span className="text-slate-500 block text-[11px]">মেয়াদে মোট উত্তোলন:</span>
            <b className="text-rose-800 text-sm font-bold">{formatBnCurrency(totalWithdrawals)}</b>
          </div>
          <div className="border-l pl-3">
            <span className="text-slate-500 block text-[11px]">বর্তমান নিট স্থিতি:</span>
            <b className={`text-base font-black ${netBalance >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {formatBnCurrency(netBalance)}
            </b>
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="overflow-x-auto mt-4">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b bg-slate-50 text-slate-600">
              <th className="py-2.5 px-3 font-semibold">ক্রমিক</th>
              <th className="py-2.5 px-3 font-semibold">তারিখ</th>
              <th className="py-2.5 px-3 font-semibold">ভাউচার নং</th>
              <th className="py-2.5 px-3 font-semibold">লেনদেনের ধরন</th>
              <th className="py-2.5 px-3 font-semibold">মাধ্যম</th>
              <th className="py-2.5 px-3 font-semibold">সংশ্লিষ্ট ব্যাংক</th>
              <th className="py-2.5 px-3 font-semibold">বিবরণ / নোট</th>
              <th className="py-2.5 px-3 font-semibold text-right">জমা (৳)</th>
              <th className="py-2.5 px-3 font-semibold text-right">উত্তোলন (৳)</th>
              <th className="py-2.5 px-3 font-semibold text-center no-print">অ্যাকশন</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {txs.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-8 text-center text-slate-500">
                  এই সময়কালে কোনো জমা বা উত্তোলনের রেকর্ড নেই।
                </td>
              </tr>
            ) : (
              txs.map((t, i) => {
                const isDeposit = t.transactionType === "DEPOSIT";
                return (
                  <tr key={t.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 text-slate-500 font-mono">{toBn(i + 1)}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{getBengaliDateLabel(new Date(t.date))}</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-ink-800">{t.transactionNo}</td>
                    <td className="py-2.5 px-3 font-semibold">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] ${
                          isDeposit ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"
                        }`}
                      >
                        {isDeposit ? "মালিকের মূলধন জমা" : "মালিকের উত্তোলন (Drawing)"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {t.medium === "CASH" ? "💵 ক্যাশ" : "🏦 ব্যাংক"}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {t.bankAccount ? `${t.bankAccount.bankName}` : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 max-w-xs truncate">
                      {t.reference || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-emerald-700">
                      {isDeposit ? formatBnCurrency(t.amount) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-rose-700">
                      {!isDeposit ? formatBnCurrency(t.amount) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-center no-print">
                      <button
                        type="button"
                        onClick={() => onEdit(t)}
                        className="text-brand-700 hover:underline font-semibold"
                      >
                        সম্পাদনা
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-bold bg-slate-50 text-ink-900">
              <td colSpan={7} className="py-3 px-3 text-right">
                মেয়াদের সর্বমোট যোগফল:
              </td>
              <td className="py-3 px-3 text-right text-emerald-800 font-black">
                {formatBnCurrency(totalDeposits)}
              </td>
              <td className="py-3 px-3 text-right text-rose-800 font-black">
                {formatBnCurrency(totalWithdrawals)}
              </td>
              <td className="no-print" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

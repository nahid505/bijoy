"use client";

// Depot expense: Dr the expense head / Cr ডিপো ক্যাশ (the default payment method). Posts to the general book.
import { useState } from "react";
import { EntryDateInput } from "@/components/entry-date-input";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SearchableAccountSelect } from "@/components/account-select";
import type { AccountOption } from "@/components/trade-parts";
import { formatMoney } from "@/lib/format";

export interface DepotExpenseValues {
  date: string;
  expenseAccountId: string;
  cashAccountId: string;
  amount: number | "";
  reference: string;
  narration: string;
}

export function DepotExpenseForm({ action, initial, known, depotCashId, balance, dateLocked, currency, editing }: {
  action: FormAction;
  initial: DepotExpenseValues;
  /** accounts the pickers already know (the chosen head, cash / bank accounts) */
  known: AccountOption[];
  depotCashId: string | null;
  /** ডিপো ক্যাশ balance in the box (both books), before this expense */
  balance: number | null;
  dateLocked?: boolean;
  currency: string;
  editing?: boolean;
}) {
  const [date, setDate] = useState(initial.date);
  const [head, setHead] = useState(initial.expenseAccountId);
  const [cash, setCash] = useState(initial.cashAccountId);
  const [amount, setAmount] = useState(String(initial.amount));
  const fromDepotCash = cash === depotCashId && balance !== null;
  const after = fromDepotCash ? balance - (Number(amount) || 0) : null;
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="expenseAccountId" value={head} />
      <input type="hidden" name="cashAccountId" value={cash} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="তারিখ *" name="date"><EntryDateInput id="expense-date" value={date} onChange={setDate} locked={dateLocked} /></Field>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="expense-head">খরচের খাত *</label>
          <SearchableAccountSelect id="expense-head" scope="expense" known={known} value={head} onChange={setHead} currency={currency} placeholder="— খরচের খাত নির্বাচন —" />
          <FieldError name="expenseAccountId" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="expense-cash">পেমেন্ট মেথড *</label>
          <SearchableAccountSelect id="expense-cash" scope="cash" known={known} value={cash} onChange={setCash} currency={currency} />
          <FieldError name="cashAccountId" />
        </div>
        <Field label="টাকার পরিমাণ *" name="amount" hint={after !== null ? `ডিপো ক্যাশে আছে ${formatMoney(balance!, currency)} → খরচের পর ${formatMoney(after, currency)}` : undefined}>
          <input id="expense-amount" name="amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-num" required />
        </Field>
        <Field label="ভাউচার / মেমো নং" name="reference"><input id="expense-reference" name="reference" defaultValue={initial.reference} className="input" maxLength={100} /></Field>
      </div>
      {after !== null && after < 0 && <p className="text-sm font-medium text-red-600" id="expense-short">ডিপো ক্যাশে পর্যাপ্ত টাকা নেই — আগে মূল ক্যাশ থেকে ফান্ড স্থানান্তর করুন।</p>}
      <Field label="বিবরণ" name="narration"><textarea id="expense-narration" name="narration" defaultValue={initial.narration} className="input" rows={2} maxLength={500} placeholder="যেমন: গুদাম ভাড়া — অক্টোবর" /></Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton>{editing ? "পরিবর্তন সংরক্ষণ করুন" : "খরচ সংরক্ষণ করুন"}</SubmitButton>
        {!editing && <button type="submit" name="then" value="new" className="btn-secondary">সংরক্ষণ ও আরেকটি</button>}
      </div>
    </ActionForm>
  );
}

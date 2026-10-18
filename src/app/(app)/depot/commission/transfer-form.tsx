"use client";

// Depot commission → the business's general income: the only link between the depot and general books.
import { useState } from "react";
import { EntryDateInput } from "@/components/entry-date-input";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SearchableAccountSelect } from "@/components/account-select";
import type { AccountOption } from "@/components/trade-parts";
import { formatMoney } from "@/lib/format";

export function CommissionTransferForm({ action, available, cashAccounts, today, dateLocked, currency }: {
  action: FormAction;
  available: number;
  cashAccounts: AccountOption[];
  today: string;
  dateLocked?: boolean;
  currency: string;
}) {
  const [date, setDate] = useState(today);
  const [depotCash, setDepotCash] = useState(cashAccounts[0]?.id ?? "");
  const [generalCash, setGeneralCash] = useState(cashAccounts[0]?.id ?? "");
  if (available <= 0) return <p className="text-sm text-slate-500">স্থানান্তরযোগ্য কোনো কমিশন নেই।</p>;
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="depotCashAccountId" value={depotCash} />
      <input type="hidden" name="generalCashAccountId" value={generalCash} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="টাকা *" name="amount" hint={`সর্বোচ্চ ${formatMoney(available, currency)}`}>
          <input id="transfer-amount" name="amount" type="number" min="0" step="0.01" max={available} defaultValue={available} className="input-num" required />
        </Field>
        <Field label="তারিখ" name="date"><EntryDateInput id="transfer-date" value={date} onChange={setDate} locked={dateLocked} /></Field>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="transfer-depot-cash">ডিপোর যে নগদ/ব্যাংক থেকে *</label>
          <SearchableAccountSelect id="transfer-depot-cash" scope="cash" book="depot" known={cashAccounts} value={depotCash} onChange={setDepotCash} currency={currency} />
          <FieldError name="depotCashAccountId" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="transfer-general-cash">সাধারণ হিসাবের যে নগদ/ব্যাংকে *</label>
          <SearchableAccountSelect id="transfer-general-cash" scope="cash" known={cashAccounts} value={generalCash} onChange={setGeneralCash} currency={currency} />
          <FieldError name="generalCashAccountId" />
        </div>
      </div>
      <Field label="রেফারেন্স" name="reference"><input id="transfer-reference" name="reference" className="input max-w-md" maxLength={100} /></Field>
      <SubmitButton pendingText="স্থানান্তর হচ্ছে…">সাধারণ আয়ে স্থানান্তর করুন</SubmitButton>
    </ActionForm>
  );
}

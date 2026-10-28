"use client";

// Commission from a company: received in cash/bank, or adjusted against what the depot owes the company.
import { useState } from "react";
import { EntryDateInput } from "@/components/entry-date-input";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SearchableAccountSelect } from "@/components/account-select";
import type { AccountOption } from "@/components/trade-parts";
import { formatMoney } from "@/lib/format";
import { useT } from "@/components/lang";

export function CommissionSettleForm({ action, companies, cashAccounts, today, dateLocked, currency }: {
  action: FormAction;
  companies: { id: string; name: string; outstanding: number }[];
  cashAccounts: AccountOption[];
  today: string;
  dateLocked?: boolean;
  currency: string;
}) {
  const t = useT();
  const due = companies.filter((c) => c.outstanding > 0);
  const [companyId, setCompanyId] = useState(due[0]?.id ?? "");
  const [method, setMethod] = useState<"CASH" | "ADJUST">("ADJUST");
  const [date, setDate] = useState(today);
  const [cashId, setCashId] = useState(cashAccounts[0]?.id ?? "");
  const outstanding = companies.find((c) => c.id === companyId)?.outstanding ?? 0;
  if (!due.length) return <p className="text-sm text-slate-500">{t("কোনো কোম্পানির কাছে কমিশন প্রাপ্য নেই।")}</p>;
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="cashAccountId" value={method === "CASH" ? cashId : ""} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="কোম্পানি *" name="companyAccountId">
          <select id="companyAccountId" name="companyAccountId" className="input" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {due.map((c) => <option key={c.id} value={c.id}>{c.name} — {t("প্রাপ্য")} {formatMoney(c.outstanding, currency)}</option>)}
          </select>
        </Field>
        <Field label="টাকা *" name="amount" hint={`${t("সর্বোচ্চ")} ${formatMoney(outstanding, currency)}`}>
          <input id="amount" name="amount" type="text" inputMode="decimal" data-numeric min="0" step="0.01" max={outstanding} className="input-num" required />
        </Field>
        <Field label="তারিখ" name="date"><EntryDateInput id="settle-date" value={date} onChange={setDate} locked={dateLocked} /></Field>
        <Field label="রেফারেন্স" name="reference"><input id="reference" name="reference" className="input" maxLength={100} placeholder={t("চেক / স্টেটমেন্ট নং")} /></Field>
      </div>
      <fieldset className="min-w-0">
        <legend className="mb-1 text-sm font-medium text-ink-800">{t("কীভাবে")}</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={method === "ADJUST"} onChange={() => setMethod("ADJUST")} /> {t("কোম্পানির পাওনার সাথে সমন্বয় (কোম্পানির কাছে দেনা কমবে)")}</label>
          <label className="flex items-center gap-2"><input type="radio" checked={method === "CASH"} onChange={() => setMethod("CASH")} /> {t("নগদ/ব্যাংকে কমিশন আদায়")}</label>
        </div>
      </fieldset>
      {method === "CASH" && (
        <div className="max-w-md">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="settle-cash">{t("যে হিসাবে টাকা এসেছে *")}</label>
          <SearchableAccountSelect id="settle-cash" scope="cash" book="depot" known={cashAccounts} value={cashId} onChange={setCashId} currency={currency} />
          <FieldError name="cashAccountId" />
        </div>
      )}
      <SubmitButton pendingText="সংরক্ষণ হচ্ছে…">কমিশন সংরক্ষণ করুন</SubmitButton>
    </ActionForm>
  );
}

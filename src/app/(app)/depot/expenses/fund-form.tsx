"use client";

// Fund transfer main cash / bank ⇄ ডিপো ক্যাশ (general journal).
import { useState } from "react";
import { EntryDateInput } from "@/components/entry-date-input";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SearchableAccountSelect } from "@/components/account-select";
import type { AccountOption } from "@/components/trade-parts";
import { useT } from "@/components/lang";

export function DepotFundForm({ action, mainAccounts, today, dateLocked, currency }: {
  action: FormAction;
  /** cash / bank accounts other than ডিপো ক্যাশ */
  mainAccounts: AccountOption[];
  today: string;
  dateLocked?: boolean;
  currency: string;
}) {
  const t = useT();
  const [date, setDate] = useState(today);
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [main, setMain] = useState(mainAccounts[0]?.id ?? "");
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="mainAccountId" value={main} />
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="radio" name="direction" value="IN" checked={direction === "IN"} onChange={() => setDirection("IN")} /> {t("মূল ক্যাশ/ব্যাংক → ডিপো ক্যাশ (ফান্ড দেওয়া)")}</label>
        <label className="flex items-center gap-2"><input type="radio" name="direction" value="OUT" checked={direction === "OUT"} onChange={() => setDirection("OUT")} /> {t("ডিপো ক্যাশ → মূল ক্যাশ/ব্যাংক (ফেরত)")}</label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="fund-main">{t(direction === "IN" ? "যে নগদ/ব্যাংক থেকে *" : "যে নগদ/ব্যাংকে *")}</label>
          <SearchableAccountSelect id="fund-main" scope="cash" known={mainAccounts} value={main} onChange={setMain} currency={currency} />
          <FieldError name="mainAccountId" />
        </div>
        <Field label="টাকা *" name="amount"><input id="fund-amount" name="amount" type="text" inputMode="decimal" data-numeric min="0" step="0.01" className="input-num" required /></Field>
        <Field label="তারিখ" name="date"><EntryDateInput id="fund-date" value={date} onChange={setDate} locked={dateLocked} /></Field>
        <Field label="রেফারেন্স" name="reference"><input id="fund-reference" name="reference" className="input" maxLength={100} /></Field>
      </div>
      <SubmitButton pendingText="স্থানান্তর হচ্ছে…">{direction === "IN" ? "ডিপো ক্যাশে ফান্ড দিন" : "মূল ক্যাশে ফেরত দিন"}</SubmitButton>
    </ActionForm>
  );
}

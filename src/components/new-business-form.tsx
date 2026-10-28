"use client";

import { MONTH_NAMES } from "@/lib/format";
import { createBusinessAction } from "@/server/actions/business";
import { ActionForm, Field, SubmitButton } from "./forms";

export function NewBusinessForm() {
  return (
    <ActionForm action={createBusinessAction} className="space-y-4">
      <Field label="ব্যবসার নাম *" name="name">
        <input id="name" name="name" className="input" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="মোবাইল" name="mobile">
          <input id="mobile" name="mobile" type="tel" inputMode="tel" className="input" />
        </Field>
        <Field label="অর্থবছর শুরু" name="fiscalYearStartMonth" hint="বাংলাদেশে সাধারণত জুলাই">
          <select id="fiscalYearStartMonth" name="fiscalYearStartMonth" defaultValue="7" className="input">
            {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
      </div>
      <Field label="ঠিকানা" name="address">
        <textarea id="address" name="address" rows={2} className="input" />
      </Field>
      <SubmitButton pendingText="তৈরি হচ্ছে…">ব্যবসা তৈরি করুন</SubmitButton>
    </ActionForm>
  );
}

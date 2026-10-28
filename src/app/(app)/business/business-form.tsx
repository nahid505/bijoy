"use client";

import { MONTH_NAMES } from "@/lib/format";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { saveBusinessAction } from "@/server/actions/business";

export interface BusinessDefaults {
  name: string;
  logo: string | null;
  address: string | null;
  mobile: string | null;
  email: string | null;
  binNumber: string | null;
  tinNumber: string | null;
  tradeLicense: string | null;
  currency: string;
  currencySymbol: string;
  fiscalYearStartMonth: number;
  booksStartDate: string;
  invoicePrefix: string;
  defaultVatPercent: number;
  invoiceFooter: string | null;
  invoiceTerms: string | null;
  lockDate: string;
  expiryWarningDays: number[];
  allowExpiredSale: boolean;
}

const WARNING_LABELS = ["প্রথম সতর্কতা", "দ্বিতীয় সতর্কতা", "তৃতীয় সতর্কতা", "চূড়ান্ত সতর্কতা"];

export function BusinessForm({ d }: { d: BusinessDefaults }) {
  return (
    <ActionForm action={saveBusinessAction} className="space-y-5">
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink-800">ব্যবসার প্রোফাইল</legend>
        <Field label="ব্যবসার নাম *" name="name" className="sm:col-span-2"><input id="name" name="name" defaultValue={d.name} className="input" required /></Field>
        <Field label="লোগো" name="logo" hint="PNG/JPG/WEBP/SVG, সর্বোচ্চ ২০০ KB">
          <div className="flex items-center gap-3">
            {d.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.logo} alt="লোগো" className="h-10 w-10 rounded border border-rule object-contain" />
            )}
            <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="text-xs" />
          </div>
          {d.logo && <label className="mt-1 flex items-center gap-1 text-xs"><input type="checkbox" name="removeLogo" /> লোগো সরান</label>}
        </Field>
        <Field label="মোবাইল" name="mobile"><input id="mobile" name="mobile" type="tel" inputMode="tel" defaultValue={d.mobile ?? ""} className="input" /></Field>
        <Field label="ইমেইল" name="email"><input id="email" name="email" type="email" defaultValue={d.email ?? ""} className="input" /></Field>
        <Field label="ট্রেড লাইসেন্স" name="tradeLicense"><input id="tradeLicense" name="tradeLicense" defaultValue={d.tradeLicense ?? ""} className="input" /></Field>
        <Field label="BIN (ভ্যাট নিবন্ধন)" name="binNumber"><input id="binNumber" name="binNumber" defaultValue={d.binNumber ?? ""} className="input" /></Field>
        <Field label="TIN (করদাতা শনাক্তকরণ)" name="tinNumber"><input id="tinNumber" name="tinNumber" defaultValue={d.tinNumber ?? ""} className="input" /></Field>
        <Field label="ঠিকানা" name="address" className="sm:col-span-3"><textarea id="address" name="address" rows={2} defaultValue={d.address ?? ""} className="input" /></Field>
      </fieldset>

      <fieldset className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-5">
        <legend className="mb-2 text-sm font-semibold text-ink-800">হিসাব বছর, লক ও মুদ্রা</legend>
        <Field label="অর্থবছর শুরু" name="fiscalYearStartMonth">
          <select id="fiscalYearStartMonth" name="fiscalYearStartMonth" defaultValue={d.fiscalYearStartMonth} className="input">
            {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
        <Field label="হিসাব শুরুর তারিখ" name="booksStartDate" hint="প্রারম্ভিক ব্যালেন্স এই তারিখে পোস্ট হয়">
          <input id="booksStartDate" name="booksStartDate" type="date" defaultValue={d.booksStartDate} className="input" />
        </Field>
        <Field label="হিসাব লক তারিখ" name="lockDate" hint="এই তারিখ পর্যন্ত কোনো লেনদেন তৈরি/সম্পাদনা/মুছা যাবে না (বছর শেষে হিসাব বন্ধ)">
          <input id="lockDate" name="lockDate" type="date" defaultValue={d.lockDate} className="input" />
        </Field>
        <Field label="মুদ্রা" name="currency"><input id="currency" name="currency" defaultValue={d.currency} className="input" /></Field>
        <Field label="মুদ্রা চিহ্ন" name="currencySymbol"><input id="currencySymbol" name="currencySymbol" defaultValue={d.currencySymbol} className="input" /></Field>
      </fieldset>

      <fieldset className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-ink-800">ইনভয়েস সেটিং</legend>
        <Field label="ইনভয়েস প্রিফিক্স" name="invoicePrefix" hint="যেমন INV → INV-000001"><input id="invoicePrefix" name="invoicePrefix" defaultValue={d.invoicePrefix} className="input" /></Field>
        <Field label="ডিফল্ট ভ্যাট (%)" name="defaultVatPercent"><input id="defaultVatPercent" name="defaultVatPercent" type="text" inputMode="decimal" data-numeric min="0" max="100" step="0.01" defaultValue={d.defaultVatPercent} className="input-num" /></Field>
        <Field label="ইনভয়েস ফুটার" name="invoiceFooter" className="sm:col-span-2"><input id="invoiceFooter" name="invoiceFooter" defaultValue={d.invoiceFooter ?? ""} className="input" /></Field>
        <Field label="শর্তাবলি (ইনভয়েসে)" name="invoiceTerms" className="sm:col-span-4"><textarea id="invoiceTerms" name="invoiceTerms" rows={2} defaultValue={d.invoiceTerms ?? ""} className="input" /></Field>
      </fieldset>
      <fieldset className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-ink-800">মেয়াদ (Expiry) ব্যবস্থাপনা</legend>
        <p className="text-xs text-slate-500 sm:col-span-4">মেয়াদ শেষ হওয়ার কত দিন আগে সতর্কবার্তা তৈরি হবে। প্রতিদিন স্বয়ংক্রিয় যাচাইয়ে প্রতিটি ব্যাচের জন্য প্রতিটি ধাপে একবারই নোটিফিকেশন তৈরি হয়। ঘর খালি রাখলে সেই ধাপ বাদ যাবে।</p>
        {WARNING_LABELS.map((label, i) => (
          <Field key={label} label={`${label} (দিন আগে)`} name="expiryWarningDays">
            <input name="expiryWarningDays" type="text" inputMode="decimal" data-numeric min="1" max="3650" step="1" defaultValue={d.expiryWarningDays[i] ?? ""} className="input-num" aria-label={label} />
          </Field>
        ))}
        <label className="flex items-start gap-2 text-sm sm:col-span-4">
          <input type="checkbox" name="allowExpiredSale" defaultChecked={d.allowExpiredSale} className="mt-1" />
          <span>
            মেয়াদোত্তীর্ণ ব্যাচ বিক্রির অনুমতি দিন
            <span className="block text-xs text-slate-500">বন্ধ থাকলে (প্রস্তাবিত) মেয়াদোত্তীর্ণ ব্যাচ বিক্রি করা যাবে না। চালু থাকলেও FEFO কখনো স্বয়ংক্রিয়ভাবে মেয়াদোত্তীর্ণ ব্যাচ বাছাই করে না — হাতে নির্বাচন করতে হবে।</span>
          </span>
        </label>
      </fieldset>
      <SubmitButton>সংরক্ষণ করুন</SubmitButton>
    </ActionForm>
  );
}

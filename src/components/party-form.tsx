"use client";

import Link from "next/link";
import { ActionForm, Field, SubmitButton, type FormAction } from "./forms";
import { useT } from "./lang";

export interface PartyDefaults {
  name?: string;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  openingBalance?: number;
  notes?: string | null;
  creditLimit?: number;
  creditDays?: number;
  groupName?: string | null;
  route?: string | null;
  ownerName?: string | null;
}

export function PartyForm({
  action,
  defaults = {},
  cancelHref,
  openingHint,
  kind = "CUSTOMER",
  showRoute = false,
  dealer = false,
}: {
  action: FormAction;
  defaults?: PartyDefaults;
  cancelHref: string;
  openingHint: string;
  kind?: "CUSTOMER" | "SUPPLIER";
  /** depot businesses: the dealer's route / area */
  showRoute?: boolean;
  /** depot dealer: the shop / business name and the proprietor, two fields */
  dealer?: boolean;
}) {
  const t = useT();
  return (
    <ActionForm action={action}>
      <div className="grid gap-4 sm:grid-cols-2">
        {dealer ? (
          <>
            <Field label="প্রতিষ্ঠানের নাম *" name="name"><input id="name" name="name" defaultValue={defaults.name} className="input" required maxLength={200} placeholder={t("যেমন: মেসার্স রহমান ট্রেডার্স")} /></Field>
            <Field label="মালিকের নাম" name="ownerName"><input id="ownerName" name="ownerName" defaultValue={defaults.ownerName ?? ""} className="input" maxLength={150} placeholder={t("যেমন: মোঃ আব্দুর রহমান")} /></Field>
          </>
        ) : (
          <Field label="নাম *" name="name"><input id="name" name="name" defaultValue={defaults.name} className="input" required maxLength={200} /></Field>
        )}
        <Field label="মোবাইল" name="mobile"><input id="mobile" name="mobile" type="tel" defaultValue={defaults.mobile ?? ""} className="input" inputMode="tel" placeholder="01XXXXXXXXX" /></Field>
        <Field label="ইমেইল" name="email"><input id="email" name="email" type="email" defaultValue={defaults.email ?? ""} className="input" /></Field>
        <Field label="প্রারম্ভিক ব্যালেন্স (৳)" name="openingBalance" hint={openingHint}>
          <input id="openingBalance" name="openingBalance" type="text" inputMode="decimal" data-numeric step="0.01" min="0" defaultValue={defaults.openingBalance ?? 0} className="input-num" />
        </Field>
        {kind === "CUSTOMER" && (
          <Field label="কাস্টমার গ্রুপ" name="groupName" hint="যেমন: পাইকারি, খুচরা, এলাকা — গ্রুপে এসএমএস পাঠাতে ব্যবহার হয়">
            <input id="groupName" name="groupName" maxLength={60} defaultValue={defaults.groupName ?? ""} className="input" />
          </Field>
        )}
        {kind === "CUSTOMER" && showRoute && (
          <Field label="রুট / এরিয়া" name="route" hint="ডিলার কোন রুট/এরিয়ার — রুটভিত্তিক মার্কেট বাকি রিপোর্টে ব্যবহার হয়">
            <input id="route" name="route" maxLength={80} defaultValue={defaults.route ?? ""} className="input" placeholder={t("যেমন: রুট-১ বীরগঞ্জ")} />
          </Field>
        )}
        {kind === "CUSTOMER" && (
          <Field label="ক্রেডিট সীমা (৳)" name="creditLimit" hint="সর্বোচ্চ কত টাকা বাকি রাখা যাবে — ০ = সীমা নেই">
            <input id="creditLimit" name="creditLimit" type="text" inputMode="decimal" data-numeric step="0.01" min="0" defaultValue={defaults.creditLimit ?? 0} className="input-num" />
          </Field>
        )}
        <Field label="পরিশোধের মেয়াদ (দিন)" name="creditDays" hint="ইনভয়েসের কত দিন পর বাকি মেয়াদোত্তীর্ণ হবে">
          <input id="creditDays" name="creditDays" type="text" inputMode="decimal" data-numeric step="1" min="0" defaultValue={defaults.creditDays ?? 0} className="input-num" />
        </Field>
        <Field label="ঠিকানা" name="address" className="sm:col-span-2"><textarea id="address" name="address" rows={2} defaultValue={defaults.address ?? ""} className="input" /></Field>
        <Field label="নোট" name="notes" className="sm:col-span-2"><textarea id="notes" name="notes" rows={2} defaultValue={defaults.notes ?? ""} className="input" /></Field>
      </div>
      <div className="flex gap-2">
        <SubmitButton>{t("সংরক্ষণ করুন")}</SubmitButton>
        <Link prefetch={false} href={cancelHref} className="btn-secondary">{t("বাতিল")}</Link>
      </div>
    </ActionForm>
  );
}

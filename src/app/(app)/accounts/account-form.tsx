"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/forms";

export interface GroupOption {
  id: string;
  name: string;
  nature: string;
  systemKey: string | null;
}

export function AccountForm({
  action,
  groups,
  defaults,
  lockGroup,
  cancelHref,
}: {
  action: FormAction;
  groups: GroupOption[];
  defaults?: { name: string; code: string | null; groupId: string; description: string | null; bankName: string | null; accountNumber: string | null; openingBalance: number; openingSide: "DR" | "CR" };
  lockGroup?: boolean;
  cancelHref: string;
}) {
  const [groupId, setGroupId] = useState(defaults?.groupId ?? "");
  const group = groups.find((g) => g.id === groupId);
  const naturalSide = group && (group.nature === "ASSET" || group.nature === "EXPENSE") ? "DR" : "CR";
  return (
    <ActionForm action={action}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="হিসাবের নাম *" name="name"><input id="name" name="name" defaultValue={defaults?.name} className="input" required /></Field>
        <Field label="কোড" name="code" hint="ঐচ্ছিক, অনন্য"><input id="code" name="code" defaultValue={defaults?.code ?? ""} className="input" /></Field>
        <Field label="গ্রুপ *" name="groupId">
          <select id="groupId" name="groupId" className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={lockGroup}>
            <option value="">— গ্রুপ নির্বাচন —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {lockGroup && <input type="hidden" name="groupId" value={groupId} />}
        </Field>
        <Field label="বিবরণ" name="description"><input id="description" name="description" defaultValue={defaults?.description ?? ""} className="input" /></Field>
        {group?.systemKey === "BANK_ACCOUNTS" && (
          <>
            <Field label="ব্যাংক / প্রতিষ্ঠান" name="bankName"><input id="bankName" name="bankName" defaultValue={defaults?.bankName ?? ""} className="input" /></Field>
            <Field label="হিসাব নম্বর" name="accountNumber"><input id="accountNumber" name="accountNumber" defaultValue={defaults?.accountNumber ?? ""} className="input" /></Field>
          </>
        )}
        <Field label="প্রারম্ভিক ব্যালেন্স" name="openingBalance" hint="ব্যবসার হিসাব শুরুর তারিখের ব্যালেন্স">
          <input id="openingBalance" name="openingBalance" type="number" min="0" step="0.01" defaultValue={defaults?.openingBalance ?? 0} className="input-num" />
        </Field>
        <Field label="ব্যালেন্সের দিক" name="openingSide">
          <select id="openingSide" name="openingSide" key={naturalSide} defaultValue={defaults?.openingSide ?? naturalSide} className="input">
            <option value="DR">ডেবিট (সম্পদ/ব্যয়/পাওনা)</option>
            <option value="CR">ক্রেডিট (দায়/মূলধন/আয়)</option>
          </select>
        </Field>
      </div>
      <div className="flex gap-2">
        <SubmitButton>সংরক্ষণ করুন</SubmitButton>
        <Link prefetch={false} href={cancelHref} className="btn-secondary">বাতিল</Link>
      </div>
    </ActionForm>
  );
}

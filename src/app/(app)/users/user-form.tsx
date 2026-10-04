"use client";

import Link from "next/link";
import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/forms";

export function UserForm({
  action,
  roles,
  defaults,
  isEdit,
}: {
  action: FormAction;
  roles: { id: string; name: string }[];
  defaults?: { name: string; email: string; roleId: string; isActive: boolean };
  isEdit: boolean;
}) {
  return (
    <ActionForm action={action}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="নাম *" name="name">
          <input id="name" name="name" defaultValue={defaults?.name} className="input" required />
        </Field>
        <Field label="ইমেইল (লগইন) *" name="email" hint={isEdit ? undefined : "আগে থেকে অ্যাকাউন্ট থাকলে শুধু এই ব্যবসায় যুক্ত হবে"}>
          <input id="email" name="email" type="email" defaultValue={defaults?.email} className="input" required autoComplete="off" />
        </Field>
        <Field label="রোল *" name="roleId">
          <select id="roleId" name="roleId" defaultValue={defaults?.roleId ?? ""} className="input" required>
            <option value="">— নির্বাচন করুন —</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
        <Field label={isEdit ? "নতুন পাসওয়ার্ড" : "পাসওয়ার্ড"} name="password" hint={isEdit ? "পরিবর্তন না করতে ফাঁকা রাখুন" : "নতুন অ্যাকাউন্টের জন্য আবশ্যক (কমপক্ষে ৮ অক্ষর)"}>
          <input id="password" name="password" type="password" className="input" autoComplete="new-password" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={defaults?.isActive ?? true} /> এই ব্যবসায় সক্রিয়
        </label>
      </div>
      <div className="flex gap-2">
        <SubmitButton>সংরক্ষণ করুন</SubmitButton>
        <Link prefetch={false} href="/users" className="btn-secondary">বাতিল</Link>
      </div>
    </ActionForm>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/forms";
import { PartyMultiSelect, type PartyChoice } from "@/components/party-multi-select";

export interface RoleChoice {
  id: string;
  name: string;
  /** the role ticks "শুধু নির্ধারিত কাস্টমার / সরবরাহকারী" */
  customersOnly?: boolean;
  suppliersOnly?: boolean;
}

export function UserForm({
  action,
  roles,
  defaults,
  isEdit,
  assigned,
}: {
  action: FormAction;
  roles: RoleChoice[];
  defaults?: { name: string; email: string; roleId: string; isActive: boolean };
  isEdit: boolean;
  /** user-specific customer / supplier assignment (null: the section is not shown) */
  assigned?: { customers: PartyChoice[]; suppliers: PartyChoice[] } | null;
}) {
  const [roleId, setRoleId] = useState(defaults?.roleId ?? "");
  const role = roles.find((r) => r.id === roleId);
  const note = (on: boolean | undefined, what: string) =>
    on ? (
      <p className="mt-1 text-xs text-brand-700">✔ নির্বাচিত রোলে কার্যকর — এই ব্যবহারকারী শুধু নিচের {what} দেখবেন</p>
    ) : (
      <p className="mt-1 text-xs text-slate-500">নির্বাচিত রোলে &quot;শুধু নির্ধারিত {what}&quot; অনুমতি নেই — তালিকাটি সংরক্ষিত থাকবে, তবে এখন সব {what} দেখা যাবে</p>
    );
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
          <select id="roleId" name="roleId" value={roleId} onChange={(e) => setRoleId(e.target.value)} className="input" required>
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
      {assigned && (
        <fieldset className="rounded-lg border border-slate-200 p-4" id="party-assignment">
          <legend className="px-1 text-sm font-semibold text-slate-700">কাস্টমার ও সরবরাহকারী নির্ধারণ</legend>
          <p className="mb-3 text-xs text-slate-500">রোলে &quot;শুধু নির্ধারিত কাস্টমার/সরবরাহকারী দেখতে পারবে&quot; টিক দেওয়া থাকলে এই ব্যবহারকারী শুধু এখানে নির্বাচিতদের তথ্য, লেনদেন, লেজার ও রিপোর্ট দেখবেন।</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <PartyMultiSelect kind="customers" name="customerIds" label="নির্ধারিত কাস্টমারসমূহ" initial={assigned.customers} />
              {note(role?.customersOnly, "কাস্টমার")}
            </div>
            <div>
              <PartyMultiSelect kind="suppliers" name="supplierIds" label="নির্ধারিত সরবরাহকারীসমূহ" initial={assigned.suppliers} />
              {note(role?.suppliersOnly, "সরবরাহকারী")}
            </div>
          </div>
          <input type="hidden" name="assignment" value="1" />
        </fieldset>
      )}
      <div className="flex gap-2">
        <SubmitButton>সংরক্ষণ করুন</SubmitButton>
        <Link prefetch={false} href="/users" className="btn-secondary">বাতিল</Link>
      </div>
    </ActionForm>
  );
}

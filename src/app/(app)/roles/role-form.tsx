"use client";

import Link from "next/link";
import { PERMISSION_GROUPS } from "@/lib/permissions";
import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/forms";

export function RoleForm({
  action,
  defaults,
  readOnly,
}: {
  action: FormAction;
  defaults?: { name: string; description: string | null; permissions: string[] };
  readOnly?: boolean;
}) {
  const all = defaults?.permissions.includes("*") ?? false;
  return (
    <ActionForm action={action}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="রোলের নাম *" name="name">
          <input id="name" name="name" defaultValue={defaults?.name} className="input" required disabled={readOnly} />
        </Field>
        <Field label="বিবরণ" name="description">
          <input id="description" name="description" defaultValue={defaults?.description ?? ""} className="input" disabled={readOnly} />
        </Field>
      </div>

      <div>
        <p className="label">অনুমতিসমূহ</p>
        {all && <p className="mb-3 text-sm text-brand-700">এই রোলের সব অনুমতি আছে (সিস্টেম অ্যাডমিন)।</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {PERMISSION_GROUPS.map((g) => (
            <fieldset key={g.label} className="rounded-lg border border-slate-200 p-4">
              <legend className="px-1 text-sm font-semibold text-slate-700">{g.label}</legend>
              <div className="space-y-2">
                {g.permissions.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="permissions"
                      value={p.key}
                      defaultChecked={all || defaults?.permissions.includes(p.key)}
                      disabled={readOnly}
                    />
                    {p.label}
                    <code className="ml-auto text-xs text-slate-400">{p.key}</code>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        {!readOnly && <SubmitButton>সংরক্ষণ করুন</SubmitButton>}
        <Link prefetch={false} href="/roles" className="btn-secondary">{readOnly ? "ফিরে যান" : "বাতিল"}</Link>
      </div>
    </ActionForm>
  );
}

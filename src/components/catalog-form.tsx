"use client";

import Link from "next/link";
import { ActionForm, Field, SubmitButton, type FormAction } from "./forms";
import { useT } from "./lang";

/** Inline add/edit form for category, brand, unit and warehouse lists. */
export function CatalogForm({
  action,
  kind,
  returnTo,
  defaults,
  baseUnits = [],
  editing,
}: {
  action: FormAction;
  kind: "category" | "brand" | "unit" | "warehouse";
  returnTo: string;
  defaults?: { name?: string; baseUnitId?: string | null; factor?: number; address?: string | null };
  baseUnits?: { id: string; name: string }[];
  editing: boolean;
}) {
  const t = useT();
  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="returnTo" value={returnTo} />
      <Field label="নাম *" name="name"><input id="name" name="name" defaultValue={defaults?.name} className="input w-56" required /></Field>
      {kind === "unit" && (
        <>
          <Field label="মূল ইউনিট (বিকল্প ইউনিটের জন্য)" name="baseUnitId">
            <select id="baseUnitId" name="baseUnitId" defaultValue={defaults?.baseUnitId ?? ""} className="input w-48">
              <option value="">{t("— নিজেই মূল ইউনিট —")}</option>
              {baseUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="রূপান্তর হার" name="factor" hint="১ এই ইউনিট = কত মূল ইউনিট">
            <input id="factor" name="factor" type="text" inputMode="decimal" data-numeric min="0" step="0.000001" defaultValue={defaults?.factor ?? 1} className="input-num w-32" />
          </Field>
        </>
      )}
      {kind === "warehouse" && <Field label="ঠিকানা" name="address"><input id="address" name="address" defaultValue={defaults?.address ?? ""} className="input w-64" /></Field>}
      <SubmitButton>{editing ? t("হালনাগাদ করুন") : t("+ যোগ করুন")}</SubmitButton>
      {editing && <Link prefetch={false} href={returnTo} className="btn-ghost">{t("বাতিল")}</Link>}
    </ActionForm>
  );
}

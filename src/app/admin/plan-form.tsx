"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/forms";

export interface PlanFormDefaults {
  code: string;
  nameBn: string;
  nameEn: string;
  descriptionBn: string;
  descriptionEn: string;
  priceMonthly: number;
  priceYearly: number;
  userLimit: string; // "" = unlimited
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  features: string[];
}

export function PlanForm({ action, defaults, features }: { action: FormAction; defaults: PlanFormDefaults; features: { key: string; nameBn: string; nameEn: string; icon: string; soon: boolean }[] }) {
  const [f, setF] = useState(defaults);
  const set = <K extends keyof PlanFormDefaults>(k: K, v: PlanFormDefaults[K]) => setF((x) => ({ ...x, [k]: v }));
  const payload = JSON.stringify({ ...f, userLimit: f.userLimit === "" ? null : Number(f.userLimit), descriptionBn: f.descriptionBn || null, descriptionEn: f.descriptionEn || null });
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="কোড *" name="code" hint="যেমন BUSINESS"><input id="code" className="input font-mono uppercase" value={f.code} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
        <Field label="নাম (বাংলা) *" name="nameBn"><input id="nameBn" className="input" value={f.nameBn} onChange={(e) => set("nameBn", e.target.value)} /></Field>
        <Field label="নাম (English) *" name="nameEn"><input id="nameEn" className="input" value={f.nameEn} onChange={(e) => set("nameEn", e.target.value)} /></Field>
        <Field label="ক্রম" name="sortOrder"><input id="sortOrder" type="text" inputMode="decimal" data-numeric min="0" className="input-num" value={f.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} /></Field>
        <Field label="মাসিক মূল্য (৳)" name="priceMonthly"><input id="priceMonthly" type="text" inputMode="decimal" data-numeric min="0" step="1" className="input-num" value={f.priceMonthly} onChange={(e) => set("priceMonthly", Number(e.target.value))} /></Field>
        <Field label="বার্ষিক মূল্য (৳)" name="priceYearly"><input id="priceYearly" type="text" inputMode="decimal" data-numeric min="0" step="1" className="input-num" value={f.priceYearly} onChange={(e) => set("priceYearly", Number(e.target.value))} /></Field>
        <Field label="ব্যবহারকারী সীমা" name="userLimit" hint="ফাঁকা = সীমাহীন"><input id="userLimit" type="text" inputMode="decimal" data-numeric min="1" className="input-num" value={f.userLimit} onChange={(e) => set("userLimit", e.target.value)} /></Field>
        <div className="flex items-end gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} /> সক্রিয়</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isPublic} onChange={(e) => set("isPublic", e.target.checked)} /> প্রাইসিং পাতায় দেখান</label>
        </div>
        <Field label="বিবরণ (বাংলা)" name="descriptionBn" className="sm:col-span-2"><input id="descriptionBn" className="input" value={f.descriptionBn} onChange={(e) => set("descriptionBn", e.target.value)} /></Field>
        <Field label="Description (English)" name="descriptionEn" className="sm:col-span-2"><input id="descriptionEn" className="input" value={f.descriptionEn} onChange={(e) => set("descriptionEn", e.target.value)} /></Field>
      </div>
      <fieldset className="rounded-lg border border-rule p-4">
        <legend className="px-1 text-sm font-semibold">ফিচার</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((x) => (
            <label key={x.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.features.includes(x.key)} onChange={(e) => set("features", e.target.checked ? [...f.features, x.key] : f.features.filter((k) => k !== x.key))} />
              <span aria-hidden>{x.icon}</span> {x.nameBn} <span className="text-xs text-slate-400">{x.nameEn}{x.soon ? " · শীঘ্রই" : ""}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2"><SubmitButton>সংরক্ষণ করুন</SubmitButton><Link prefetch={false} href="/admin/plans" className="btn-secondary">বাতিল</Link></div>
    </ActionForm>
  );
}

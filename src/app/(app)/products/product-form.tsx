"use client";

import Link from "next/link";
import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/forms";

export interface ProductDefaults {
  name?: string;
  code?: string | null;
  barcode?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  unitId?: string;
  purchasePrice?: number;
  salePrice?: number;
  wholesalePrice?: number;
  depotCommissionRate?: number;
  minStock?: number;
  openingStock?: number;
  openingRate?: number;
  trackBatch?: boolean;
}

export function ProductForm({
  action,
  defaults = {},
  categories,
  brands,
  units,
  cancelHref,
  hasTransactions,
  showDepotCommission = false,
}: {
  action: FormAction;
  defaults?: ProductDefaults;
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  units: { id: string; name: string }[];
  cancelHref: string;
  hasTransactions?: boolean;
  /** depot businesses: commission per unit for DO releases */
  showDepotCommission?: boolean;
}) {
  return (
    <ActionForm action={action}>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink-800">মৌলিক তথ্য</legend>
        <Field label="পণ্যের নাম *" name="name" className="sm:col-span-2"><input id="name" name="name" defaultValue={defaults.name} className="input" required /></Field>
        <Field label="কোড" name="code" hint="অনন্য"><input id="code" name="code" defaultValue={defaults.code ?? ""} className="input" /></Field>
        <Field label="বারকোড" name="barcode"><input id="barcode" name="barcode" defaultValue={defaults.barcode ?? ""} className="input" /></Field>
        <Field label="ক্যাটাগরি" name="categoryId">
          <select id="categoryId" name="categoryId" defaultValue={defaults.categoryId ?? ""} className="input">
            <option value="">—</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="ব্র্যান্ড" name="brandId">
          <select id="brandId" name="brandId" defaultValue={defaults.brandId ?? ""} className="input">
            <option value="">—</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="মূল ইউনিট *" name="unitId" hint={hasTransactions ? "লেনদেন থাকায় পরিবর্তন করা যাবে না" : "স্টক এই ইউনিটে রাখা হবে; বিকল্প ইউনিট (যেমন বস্তা) লেনদেনে ব্যবহার করা যাবে"}>
          <select id="unitId" name="unitId" defaultValue={defaults.unitId ?? ""} className="input" required disabled={hasTransactions}>
            <option value="">— নির্বাচন —</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {hasTransactions && <input type="hidden" name="unitId" value={defaults.unitId} />}
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-ink-800">মূল্য (মূল ইউনিট প্রতি)</legend>
        <Field label="ক্রয়মূল্য" name="purchasePrice"><input id="purchasePrice" name="purchasePrice" type="number" step="0.01" min="0" defaultValue={defaults.purchasePrice ?? 0} className="input-num" /></Field>
        <Field label="বিক্রয়মূল্য (খুচরা)" name="salePrice"><input id="salePrice" name="salePrice" type="number" step="0.01" min="0" defaultValue={defaults.salePrice ?? 0} className="input-num" /></Field>
        <Field label="পাইকারি মূল্য" name="wholesalePrice"><input id="wholesalePrice" name="wholesalePrice" type="number" step="0.01" min="0" defaultValue={defaults.wholesalePrice ?? 0} className="input-num" /></Field>
        {showDepotCommission && (
          <Field label="ডিপো কমিশন (প্রতি একক)" name="depotCommissionRate" hint="ডিও রিলিজ চালানে কোম্পানির কাছ থেকে প্রাপ্য কমিশন — চালানে বদলানো যায়">
            <input id="depotCommissionRate" name="depotCommissionRate" type="number" step="0.0001" min="0" defaultValue={defaults.depotCommissionRate ?? 0} className="input-num" />
          </Field>
        )}
        <Field label="ন্যূনতম মজুদ" name="minStock" hint="এর নিচে নামলে সতর্কতা"><input id="minStock" name="minStock" type="number" step="0.001" min="0" defaultValue={defaults.minStock ?? 0} className="input-num" /></Field>
      </fieldset>

      <fieldset className="border-t border-rule pt-4">
        <legend className="mb-2 text-sm font-semibold text-ink-800">ব্যাচ ও মেয়াদ</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="trackBatch" defaultChecked={defaults.trackBatch} disabled={hasTransactions && !defaults.trackBatch} className="mt-1" />
          <span>ব্যাচ / মেয়াদ (Expiry) অনুযায়ী মজুদ রাখুন <span className="block text-xs text-slate-500">ওষুধ, খাদ্য, কসমেটিক্স ইত্যাদির জন্য — ক্রয়ে ব্যাচ নং ও মেয়াদ দিতে হবে, বিক্রয়ে ব্যাচ বাছাই করতে হবে। (প্রারম্ভিক মজুদ সাধারণ মজুদ হিসেবে থাকবে)</span></span>
        </label>
        {hasTransactions && defaults.trackBatch && <input type="hidden" name="trackBatch" value="on" />}
      </fieldset>

      <fieldset className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink-800">প্রারম্ভিক মজুদ</legend>
        <Field label="প্রারম্ভিক পরিমাণ" name="openingStock" hint="হিসাব শুরুর তারিখে প্রধান গুদামে"><input id="openingStock" name="openingStock" type="number" step="0.001" min="0" defaultValue={defaults.openingStock ?? 0} className="input-num" /></Field>
        <Field label="প্রারম্ভিক দর" name="openingRate" hint="ফাঁকা/শূন্য হলে ক্রয়মূল্য ব্যবহৃত হবে"><input id="openingRate" name="openingRate" type="number" step="0.01" min="0" defaultValue={defaults.openingRate ?? 0} className="input-num" /></Field>
        <p className="self-end pb-2 text-xs text-slate-500">প্রারম্ভিক মজুদ মূল্য “মজুদ পণ্য” লেজারে ডেবিট ও “প্রারম্ভিক ব্যালেন্স সমন্বয়” এ ক্রেডিট হিসেবে পোস্ট হবে।</p>
      </fieldset>

      <div className="flex gap-2">
        <SubmitButton>সংরক্ষণ করুন</SubmitButton>
        <Link prefetch={false} href={cancelHref} className="btn-secondary">বাতিল</Link>
      </div>
    </ActionForm>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/forms";
import { commissionPerUnit, COMMISSION_TYPE_LABELS, type DepotCommissionType } from "@/lib/depot";
import { formatMoney } from "@/lib/format";

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
  depotCommissionType?: DepotCommissionType;
  isDepotProduct?: boolean;
  minStock?: number;
  openingStock?: number;
  openingRate?: number;
  trackBatch?: boolean;
}

/**
 * variant "depot": the depot (dealership) product form (/depot/products) — company / brand, DP, dealer rate and the
 * DO commission (fixed per unit or a percent of the DP); the general form keeps category, retail and wholesale prices.
 * showDepotFlag (depot businesses): the "ডিপো পণ্য" switch — only while the product has no transactions.
 */
export function ProductForm({
  action,
  defaults = {},
  categories,
  brands,
  units,
  cancelHref,
  hasTransactions,
  variant = "general",
  showDepotFlag = false,
  currency = "৳",
}: {
  action: FormAction;
  defaults?: ProductDefaults;
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  units: { id: string; name: string }[];
  cancelHref: string;
  hasTransactions?: boolean;
  variant?: "general" | "depot";
  showDepotFlag?: boolean;
  currency?: string;
}) {
  const depot = variant === "depot";
  const [commissionType, setCommissionType] = useState<DepotCommissionType>(defaults.depotCommissionType ?? "FIXED");
  const [commission, setCommission] = useState(String(defaults.depotCommissionRate ?? 0));
  const [dp, setDp] = useState(String(defaults.purchasePrice ?? 0));
  const perUnit = commissionPerUnit({ depotCommissionType: commissionType, depotCommissionRate: Number(commission) || 0, purchasePrice: Number(dp) || 0 });
  return (
    <ActionForm action={action}>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink-800">মৌলিক তথ্য</legend>
        <Field label="পণ্যের নাম *" name="name" className="sm:col-span-2"><input id="name" name="name" defaultValue={defaults.name} className="input" required /></Field>
        <Field label={depot ? "পণ্য কোড" : "কোড"} name="code" hint="অনন্য"><input id="code" name="code" defaultValue={defaults.code ?? ""} className="input" /></Field>
        <Field label="বারকোড" name="barcode"><input id="barcode" name="barcode" defaultValue={defaults.barcode ?? ""} className="input" /></Field>
        {depot ? (
          <>
            <input type="hidden" name="categoryId" value={defaults.categoryId ?? ""} />
            <Field label="কোম্পানি / ব্র্যান্ড" name="brandId">
              <select id="brandId" name="brandId" defaultValue={defaults.brandId ?? ""} className="input">
                <option value="">— তালিকা থেকে —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="নতুন কোম্পানি / ব্র্যান্ড" name="newBrandName" hint="তালিকায় না থাকলে নাম লিখুন — সংরক্ষণে যোগ হবে">
              <input id="newBrandName" name="newBrandName" className="input" maxLength={80} placeholder="যেমন: আকিজ সিমেন্ট" />
            </Field>
          </>
        ) : (
          <>
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
          </>
        )}
        <Field label="মূল ইউনিট *" name="unitId" hint={hasTransactions ? "লেনদেন থাকায় পরিবর্তন করা যাবে না" : depot ? "কার্টন, বস্তা, পিস, কেজি… — স্টক এই ইউনিটে থাকবে" : "স্টক এই ইউনিটে রাখা হবে; বিকল্প ইউনিট (যেমন বস্তা) লেনদেনে ব্যবহার করা যাবে"}>
          <select id="unitId" name="unitId" defaultValue={defaults.unitId ?? ""} className="input" required disabled={hasTransactions}>
            <option value="">— নির্বাচন —</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {hasTransactions && <input type="hidden" name="unitId" value={defaults.unitId} />}
        </Field>
      </fieldset>

      {depot ? (
        <fieldset className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold text-ink-800">দর ও কমিশন (মূল ইউনিট প্রতি)</legend>
          <Field label="কোম্পানি ক্রয় মূল্য / ডিপি (DP)" name="purchasePrice" hint="স্টক ইনের দর ও ডিলার চালানের দর">
            <input id="purchasePrice" name="purchasePrice" type="number" step="0.01" min="0" value={dp} onChange={(e) => setDp(e.target.value)} className="input-num" />
          </Field>
          <Field label="ডিলার বিক্রয় রেট" name="salePrice" hint="মার্কেট সেলস চালানের দর">
            <input id="salePrice" name="salePrice" type="number" step="0.01" min="0" defaultValue={defaults.salePrice ?? 0} className="input-num" />
          </Field>
          <input type="hidden" name="wholesalePrice" value={defaults.wholesalePrice ?? 0} />
          <Field label="কমিশনের ধরন" name="depotCommissionType">
            <select id="depotCommissionType" name="depotCommissionType" value={commissionType} onChange={(e) => setCommissionType(e.target.value as DepotCommissionType)} className="input">
              {(Object.keys(COMMISSION_TYPE_LABELS) as DepotCommissionType[]).map((k) => <option key={k} value={k}>{COMMISSION_TYPE_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field
            label={commissionType === "PERCENT" ? "কমিশন (%)" : "কমিশন (৳ প্রতি একক)"}
            name="depotCommissionRate"
            hint={commissionType === "PERCENT" ? `= ${formatMoney(perUnit, currency)} প্রতি একক — ডিও রিলিজ চালানে বদলানো যায়` : "ডিও রিলিজ চালানে কোম্পানির কাছ থেকে প্রাপ্য — চালানে বদলানো যায়"}
          >
            <input id="depotCommissionRate" name="depotCommissionRate" type="number" step="0.0001" min="0" max={commissionType === "PERCENT" ? 100 : undefined} value={commission} onChange={(e) => setCommission(e.target.value)} className="input-num" />
          </Field>
          <Field label="ন্যূনতম মজুদ" name="minStock" hint="এর নিচে নামলে সতর্কতা"><input id="minStock" name="minStock" type="number" step="0.001" min="0" defaultValue={defaults.minStock ?? 0} className="input-num" /></Field>
        </fieldset>
      ) : (
        <fieldset className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold text-ink-800">মূল্য (মূল ইউনিট প্রতি)</legend>
          <Field label="ক্রয়মূল্য" name="purchasePrice"><input id="purchasePrice" name="purchasePrice" type="number" step="0.01" min="0" defaultValue={defaults.purchasePrice ?? 0} className="input-num" /></Field>
          <Field label="বিক্রয়মূল্য (খুচরা)" name="salePrice"><input id="salePrice" name="salePrice" type="number" step="0.01" min="0" defaultValue={defaults.salePrice ?? 0} className="input-num" /></Field>
          <Field label="পাইকারি মূল্য" name="wholesalePrice"><input id="wholesalePrice" name="wholesalePrice" type="number" step="0.01" min="0" defaultValue={defaults.wholesalePrice ?? 0} className="input-num" /></Field>
          <Field label="ন্যূনতম মজুদ" name="minStock" hint="এর নিচে নামলে সতর্কতা"><input id="minStock" name="minStock" type="number" step="0.001" min="0" defaultValue={defaults.minStock ?? 0} className="input-num" /></Field>
        </fieldset>
      )}

      {showDepotFlag && (
        <fieldset className="border-t border-rule pt-4">
          <legend className="mb-2 text-sm font-semibold text-ink-800">পণ্যের ধরন</legend>
          <input type="hidden" name="depotFlag" value="1" />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" id="isDepotProduct" name="isDepotProduct" defaultChecked={defaults.isDepotProduct ?? depot} disabled={hasTransactions} className="mt-1" />
            <span>
              ডিপো পণ্য (ডিলারি ব্যবসা)
              <span className="block text-xs text-slate-500">
                ডিপো পণ্য শুধু ডিপোর স্টক ইন, চালান ও ডিপো স্টক সমন্বয়ে আসে; সাধারণ বিক্রয়, পস ও স্টকে আসে না।{hasTransactions ? " লেনদেন হয়ে যাওয়ায় আর বদলানো যাবে না।" : ""}
              </span>
            </span>
          </label>
          {hasTransactions && defaults.isDepotProduct && <input type="hidden" name="isDepotProduct" value="on" />}
        </fieldset>
      )}

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
        <p className="self-end pb-2 text-xs text-slate-500">
          প্রারম্ভিক মজুদ মূল্য “মজুদ পণ্য” লেজারে ডেবিট ও “প্রারম্ভিক ব্যালেন্স সমন্বয়” এ ক্রেডিট হিসেবে পোস্ট হবে{depot ? " — ডিপো হিসাবে (সাধারণ হিসাবে নয়)" : ""}।
        </p>
      </fieldset>

      <div className="flex gap-2">
        <SubmitButton>সংরক্ষণ করুন</SubmitButton>
        <Link prefetch={false} href={cancelHref} className="btn-secondary">বাতিল</Link>
      </div>
    </ActionForm>
  );
}

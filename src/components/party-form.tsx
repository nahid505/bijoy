"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ActionForm, Field, SubmitButton, type FormAction } from "./forms";
import { useT } from "./lang";
import { LedgerAvatar } from "./ledger-avatar";

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
  imageUrl?: string | null;
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
  const [partyName, setPartyName] = useState(defaults.name ?? "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(defaults.imageUrl ?? null);
  const [base64Value, setBase64Value] = useState<string>("");
  const [isRemoved, setIsRemoved] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsRemoved(false);
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setPreviewUrl(result);
        setBase64Value(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setPreviewUrl(null);
    setBase64Value("");
    setIsRemoved(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <ActionForm action={action}>
      {/* Square profile image upload & preview section */}
      <div className="mb-6 rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 sm:p-5">
        <label className="mb-2.5 block text-xs font-bold uppercase tracking-wider text-slate-700">
          {t("ছবি / লোগো (ঐচ্ছিক)")}
        </label>
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-5">
          {/* Square upload box (w-24 h-24 sm:w-28 sm:h-28) */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`group relative flex h-24 w-24 sm:h-28 sm:w-28 shrink-0 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition-all ${
              previewUrl
                ? "border-brand-500 bg-white ring-2 ring-brand-500/20 shadow-xs"
                : "border-gray-300 bg-white hover:border-brand-500 hover:bg-slate-50"
            }`}
            title={previewUrl ? t("ছবি পরিবর্তন করতে ক্লিক করুন") : t("ছবি আপলোড করতে ক্লিক করুন")}
          >
            {previewUrl ? (
              <>
                <img
                  src={previewUrl}
                  alt={t("প্রিভিউ")}
                  className="h-full w-full object-cover rounded-lg"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 rounded-lg">
                  <span className="text-xs font-semibold text-white flex items-center gap-1">
                    <span>📷</span>
                    <span>{t("পরিবর্তন")}</span>
                  </span>
                </div>
              </>
            ) : partyName.trim() ? (
              <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center">
                <LedgerAvatar name={partyName} imageUrl={null} size="lg" />
                <span className="mt-1 text-[10px] font-semibold text-brand-700">{t("ছবি আপলোড")}</span>
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center text-slate-400 group-hover:text-brand-600 transition-colors">
                <svg className="h-7 w-7 sm:h-8 sm:w-8 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                </svg>
                <span className="text-[11px] font-bold text-slate-600 leading-tight">{t("ছবি আপলোড করুন")}</span>
              </div>
            )}
          </div>

          {/* Action buttons & explanation text */}
          <div className="flex flex-1 flex-col items-center sm:items-start text-center sm:text-left">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary !py-1.5 !px-3 text-xs font-semibold flex items-center gap-1.5"
              >
                <span>📷</span>
                <span>{previewUrl ? t("ছবি পরিবর্তন করুন") : t("ছবি বেছে নিন")}</span>
              </button>
              {previewUrl && (
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors flex items-center gap-1"
                >
                  <span>🗑</span>
                  <span>{t("মুছে ফেলুন")}</span>
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500 leading-relaxed">
              {kind === "CUSTOMER"
                ? t("কাস্টমার/দেনাদারের ছবি বা প্রতিষ্ঠানের লোগো আপলোড করুন (JPG, PNG বা WEBP, সর্বোচ্চ ২MB)।")
                : t("সরবরাহকারী/পাওনাদারের ছবি বা লোগো আপলোড করুন (JPG, PNG বা WEBP, সর্বোচ্চ ২MB)।")}
            </p>
          </div>
        </div>

        {/* Hidden inputs for form data submission */}
        <input
          ref={fileInputRef}
          type="file"
          id="party-image-file"
          name="image"
          accept="image/*"
          className="hidden"
          onChange={handleImageChange}
        />
        <input type="hidden" name="imageBase64" value={base64Value} />
        <input type="hidden" name="removeImage" value={isRemoved ? "true" : "false"} />
        <input type="hidden" name="imageUrl" value={previewUrl && !base64Value ? previewUrl : ""} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {dealer ? (
          <>
            <Field label="প্রতিষ্ঠানের নাম *" name="name">
              <input
                id="name"
                name="name"
                defaultValue={defaults.name}
                onChange={(e) => setPartyName(e.target.value)}
                className="input"
                required
                maxLength={200}
                placeholder={t("যেমন: মেসার্স রহমান ট্রেডার্স")}
              />
            </Field>
            <Field label="মালিকের নাম" name="ownerName">
              <input
                id="ownerName"
                name="ownerName"
                defaultValue={defaults.ownerName ?? ""}
                className="input"
                maxLength={150}
                placeholder={t("যেমন: মোঃ আব্দুর রহমান")}
              />
            </Field>
          </>
        ) : (
          <Field label="নাম *" name="name">
            <input
              id="name"
              name="name"
              defaultValue={defaults.name}
              onChange={(e) => setPartyName(e.target.value)}
              className="input"
              required
              maxLength={200}
            />
          </Field>
        )}
        <Field label="মোবাইল" name="mobile">
          <input
            id="mobile"
            name="mobile"
            type="tel"
            defaultValue={defaults.mobile ?? ""}
            className="input"
            inputMode="tel"
            placeholder="01XXXXXXXXX"
          />
        </Field>
        <Field label="ইমেইল" name="email">
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={defaults.email ?? ""}
            className="input"
          />
        </Field>
        <Field label="প্রারম্ভিক ব্যালেন্স (৳)" name="openingBalance" hint={openingHint}>
          <input
            id="openingBalance"
            name="openingBalance"
            type="text"
            inputMode="decimal"
            data-numeric
            step="0.01"
            min="0"
            defaultValue={defaults.openingBalance ?? 0}
            className="input-num"
          />
        </Field>
        {kind === "CUSTOMER" && (
          <Field label="কাস্টমার গ্রুপ" name="groupName" hint="যেমন: পাইকারি, খুচরা, এলাকা — গ্রুপে এসএমএস পাঠাতে ব্যবহার হয়">
            <input
              id="groupName"
              name="groupName"
              maxLength={60}
              defaultValue={defaults.groupName ?? ""}
              className="input"
            />
          </Field>
        )}
        {kind === "CUSTOMER" && showRoute && (
          <Field label="রুট / এরিয়া" name="route" hint="ডিলার কোন রুট/এরিয়ার — রুটভিত্তিক মার্কেট বাকি রিপোর্টে ব্যবহার হয়">
            <input
              id="route"
              name="route"
              maxLength={80}
              defaultValue={defaults.route ?? ""}
              className="input"
              placeholder={t("যেমন: রুট-১ বীরগঞ্জ")}
            />
          </Field>
        )}
        {kind === "CUSTOMER" && (
          <Field label="ক্রেডিট সীমা (৳)" name="creditLimit" hint="সর্বোচ্চ কত টাকা বাকি রাখা যাবে — ০ = সীমা নেই">
            <input
              id="creditLimit"
              name="creditLimit"
              type="text"
              inputMode="decimal"
              data-numeric
              step="0.01"
              min="0"
              defaultValue={defaults.creditLimit ?? 0}
              className="input-num"
            />
          </Field>
        )}
        <Field label="পরিশোধের মেয়াদ (দিন)" name="creditDays" hint="ইনভয়েসের কত দিন পর বাকি মেয়াদোত্তীর্ণ হবে">
          <input
            id="creditDays"
            name="creditDays"
            type="text"
            inputMode="decimal"
            data-numeric
            step="1"
            min="0"
            defaultValue={defaults.creditDays ?? 0}
            className="input-num"
          />
        </Field>
        <Field label="ঠিকানা" name="address" className="sm:col-span-2">
          <textarea
            id="address"
            name="address"
            rows={2}
            defaultValue={defaults.address ?? ""}
            className="input"
          />
        </Field>
        <Field label="নোট" name="notes" className="sm:col-span-2">
          <textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={defaults.notes ?? ""}
            className="input"
          />
        </Field>
      </div>
      <div className="flex gap-2">
        <SubmitButton>{t("সংরক্ষণ করুন")}</SubmitButton>
        <Link prefetch={false} href={cancelHref} className="btn-secondary">{t("বাতিল")}</Link>
      </div>
    </ActionForm>
  );
}

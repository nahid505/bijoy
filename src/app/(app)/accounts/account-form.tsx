"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ActionForm, Field, SubmitButton, type FormAction } from "@/components/forms";
import { orderGroupTree } from "@/lib/account-groups";
import { NewGroupDialog } from "./new-group-dialog";
import { useT } from "@/components/lang";
import { LedgerAvatar } from "@/components/ledger-avatar";

export interface GroupOption {
  id: string;
  name: string;
  nature: string;
  systemKey: string | null;
  parentId: string | null;
  /** 0 = top group; sub-groups are indented in the dropdown */
  depth: number;
  /** a sub-group may be created under it */
  canParent: boolean;
}

const indent = (depth: number) => (depth > 0 ? `${"   ".repeat(depth)}└ ` : "");

export function AccountForm({
  action,
  groups,
  defaults,
  lockGroup,
  cancelHref,
  onCancel,
}: {
  action: FormAction;
  groups: GroupOption[];
  defaults?: {
    name: string;
    code: string | null;
    groupId: string;
    description: string | null;
    bankName: string | null;
    accountNumber: string | null;
    openingBalance: number;
    openingSide: "DR" | "CR";
    imageUrl?: string | null;
  };
  lockGroup?: boolean;
  cancelHref?: string;
  onCancel?: () => void;
}) {
  const t = useT();
  const [groupList, setGroupList] = useState(groups);
  const [groupId, setGroupId] = useState(defaults?.groupId ?? "");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [accountName, setAccountName] = useState(defaults?.name ?? "");

  // Image preview & upload state
  const [previewUrl, setPreviewUrl] = useState<string | null>(defaults?.imageUrl ?? null);
  const [base64Value, setBase64Value] = useState<string>("");
  const [isRemoved, setIsRemoved] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const groupSelect = useRef<HTMLSelectElement>(null);
  const group = groupList.find((g) => g.id === groupId);
  const naturalSide = group && (group.nature === "ASSET" || group.nature === "EXPENSE") ? "DR" : "CR";

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
      {/* Profile Image Upload with circular preview */}
      <div className="mb-6 rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
        <label className="mb-2 block text-xs font-semibold text-slate-700">
          {t("ছবি / লোগো আপলোড (ঐচ্ছিক)")}
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative group shrink-0">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={t("প্রিভিউ")}
                className="h-16 w-16 rounded-lg object-cover ring-2 ring-emerald-500 shadow-sm"
              />
            ) : (
              <LedgerAvatar
                name={accountName || t("হিসাব")}
                imageUrl={null}
                size="lg"
                className="ring-2 ring-slate-200"
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary !py-1.5 !px-3 text-xs font-medium"
              >
                {previewUrl ? t("ছবি পরিবর্তন করুন") : t("ছবি বেছে নিন")}
              </button>
              {previewUrl && (
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 transition-colors"
                >
                  {t("মুছে ফেলুন")}
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              {t("JPG, PNG বা WEBP (সর্বোচ্চ ২MB)। চারকোনা ফ্রেমে সুন্দরভাবে প্রদর্শিত হবে।")}
            </p>
          </div>
        </div>

        {/* Hidden inputs for form submission */}
        <input
          ref={fileInputRef}
          type="file"
          id="ledger-image-file"
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
        <Field label="হিসাবের নাম *" name="name">
          <input
            id="name"
            name="name"
            defaultValue={defaults?.name}
            onChange={(e) => setAccountName(e.target.value)}
            className="input"
            required
          />
        </Field>
        <Field label="কোড" name="code" hint="ঐচ্ছিক, অনন্য">
          <input id="code" name="code" defaultValue={defaults?.code ?? ""} className="input" />
        </Field>
        <Field label="গ্রুপ *" name="groupId">
          <div className="flex gap-2">
            <select
              ref={groupSelect}
              id="groupId"
              name="groupId"
              className="input min-w-0 flex-1"
              value={groupId}
              onChange={(e) => {
                setGroupId(e.target.value);
                setCreated(null);
              }}
              disabled={lockGroup}
            >
              <option value="">{t("— গ্রুপ নির্বাচন —")}</option>
              {groupList.map((g) => (
                <option key={g.id} value={g.id}>
                  {indent(g.depth)}
                  {g.name}
                </option>
              ))}
            </select>
            {!lockGroup && (
              <button
                type="button"
                className="btn-secondary shrink-0 whitespace-nowrap"
                onClick={() => setCreatingGroup(true)}
                aria-haspopup="dialog"
                title={t("নতুন অ্যাকাউন্ট গ্রুপ তৈরি করুন")}
              >
                {t("+ নতুন গ্রুপ")}
              </button>
            )}
          </div>
          {lockGroup && <input type="hidden" name="groupId" value={groupId} />}
          <p aria-live="polite" className="mt-1 text-xs text-emerald-700">
            {created && t('নতুন গ্রুপ "{0}" তৈরি হয়েছে ও নির্বাচিত', { 0: created })}
          </p>
        </Field>
        <Field label="বিবরণ" name="description">
          <input id="description" name="description" defaultValue={defaults?.description ?? ""} className="input" />
        </Field>
        {group?.systemKey === "BANK_ACCOUNTS" && (
          <>
            <Field label="ব্যাংক / প্রতিষ্ঠান" name="bankName">
              <input id="bankName" name="bankName" defaultValue={defaults?.bankName ?? ""} className="input" />
            </Field>
            <Field label="হিসাব নম্বর" name="accountNumber">
              <input id="accountNumber" name="accountNumber" defaultValue={defaults?.accountNumber ?? ""} className="input" />
            </Field>
          </>
        )}
        <Field label="প্রারম্ভিক ব্যালেন্স" name="openingBalance" hint="ব্যবসার হিসাব শুরুর তারিখের ব্যালেন্স">
          <input
            id="openingBalance"
            name="openingBalance"
            type="text"
            inputMode="decimal"
            data-numeric
            min="0"
            step="0.01"
            defaultValue={defaults?.openingBalance ?? 0}
            className="input-num"
          />
        </Field>
        <Field label="ব্যালেন্সের দিক" name="openingSide">
          <select id="openingSide" name="openingSide" key={naturalSide} defaultValue={defaults?.openingSide ?? naturalSide} className="input">
            <option value="DR">{t("ডেবিট (সম্পদ/ব্যয়/পাওনা)")}</option>
            <option value="CR">{t("ক্রেডিট (দায়/মূলধন/আয়)")}</option>
          </select>
        </Field>
      </div>
      <div className="mt-4 flex gap-2">
        <SubmitButton>{t("সংরক্ষণ করুন")}</SubmitButton>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="btn-secondary">
            {t("বাতিল")}
          </button>
        ) : cancelHref ? (
          <Link prefetch={false} href={cancelHref} className="btn-secondary">
            {t("বাতিল")}
          </Link>
        ) : null}
      </div>
      {creatingGroup && (
        <NewGroupDialog
          groups={groupList}
          onCancel={() => {
            setCreatingGroup(false);
            requestAnimationFrame(() => groupSelect.current?.focus());
          }}
          onCreated={(g) => {
            setGroupList((list) => orderGroupTree([...list, g]));
            setGroupId(g.id);
            setCreated(g.name);
            setCreatingGroup(false);
            requestAnimationFrame(() => groupSelect.current?.focus());
          }}
        />
      )}
    </ActionForm>
  );
}

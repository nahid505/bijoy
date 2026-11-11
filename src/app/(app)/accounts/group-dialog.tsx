"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NATURE_LABELS } from "@/lib/accounting";
import { canMoveGroupUnder } from "@/lib/account-groups";
import { createAccountGroupAction, updateAccountGroupAction } from "@/server/actions/masters";
import { useT } from "@/components/lang";
import type { GroupOption } from "./account-form";

const NATURES = ["ASSET", "LIABILITY", "INCOME", "EXPENSE", "EQUITY"] as const;
const indent = (depth: number) => (depth > 0 ? `${"\u00A0\u00A0\u00A0".repeat(depth)}└ ` : "");

export interface AccountGroupDialogProps {
  groups: GroupOption[];
  /** When provided, edits this group; otherwise creates a new group. */
  group?: GroupOption;
  onCancel: () => void;
  onSaved: (g: GroupOption) => void;
}

/** Modal dialog to create or edit an account group (name, parent group, primary nature, description). */
export function AccountGroupDialog({ groups, group, onCancel, onSaved }: AccountGroupDialogProps) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const isEdit = !!group;
  const isSystem = !!group?.systemKey;

  const [name, setName] = useState(group?.name ?? "");
  const [parentId, setParentId] = useState(group?.parentId ?? "");
  const [nature, setNature] = useState<string>(group?.nature ?? "EXPENSE");
  const [description, setDescription] = useState(group?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const parent = groups.find((g) => g.id === parentId);
  const parents = isEdit
    ? groups.filter((g) => canMoveGroupUnder(groups, group.id, g.id))
    : groups.filter((g) => g.canParent);

  const effectiveParentId = isSystem ? (group.parentId ?? "") : parentId;
  const effectiveNature = isSystem ? group.nature : parent ? parent.nature : nature;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const submit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    ev.stopPropagation(); // never submit an outer form around this portal
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      const payload = {
        name,
        nature: effectiveNature,
        parentId: effectiveParentId,
        description,
      };
      const r = isEdit
        ? await updateAccountGroupAction(group.id, payload)
        : await createAccountGroupAction(payload);
      if (r.ok) {
        onSaved(r.group);
      } else {
        setMessage(r.message);
        setErrors(r.errors ?? {});
      }
    } catch {
      setMessage(t("সার্ভারে পৌঁছানো যায়নি — আবার চেষ্টা করুন"));
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) => errors[k]?.[0];
  const parentHint = isSystem
    ? t("সিস্টেম গ্রুপের প্যারেন্ট ও মূল ধরন পরিবর্তন করা যাবে না")
    : t("ঐচ্ছিক — সাব-গ্রুপ তৈরির জন্য");
  const natureHint = isSystem
    ? t("সিস্টেম গ্রুপের প্যারেন্ট ও মূল ধরন পরিবর্তন করা যাবে না")
    : parent
      ? t("প্যারেন্ট গ্রুপের ধরনই প্রযোজ্য")
      : t("সম্পদ / দায় / আয় / ব্যয় / মূলধন");

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby="agTitle"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-rule p-0 shadow-2xl backdrop:bg-ink-950/50"
    >
      <form onSubmit={submit} className="space-y-4 p-5" noValidate>
        <h2 id="agTitle" className="text-base font-bold text-ink-900">
          {t(isEdit ? "অ্যাকাউন্ট গ্রুপ সম্পাদনা" : "নতুন অ্যাকাউন্ট গ্রুপ")}
        </h2>
        {message && (
          <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {t(message)}
          </p>
        )}
        <div>
          <label className="label" htmlFor="agName">
            {t("গ্রুপের নাম *")}
          </label>
          <input
            id="agName"
            name="agName"
            required
            maxLength={100}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            placeholder={t("যেমন: অফিস খরচ, পরিবহন খরচ")}
            aria-invalid={!!err("name")}
          />
          {err("name") && <p className="mt-1 text-xs text-red-600">{t(err("name")!)}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="agParent">
              {t("প্যারেন্ট গ্রুপ")}
            </label>
            <select
              id="agParent"
              className="input"
              value={effectiveParentId}
              disabled={isSystem}
              onChange={(e) => setParentId(e.target.value)}
              aria-invalid={!!err("parentId")}
            >
              <option value="">{t("— নেই (মূল গ্রুপ) —")}</option>
              {parents.map((g) => (
                <option key={g.id} value={g.id}>
                  {indent(g.depth)}
                  {g.name}
                </option>
              ))}
            </select>
            <p className={`mt-1 text-xs ${err("parentId") ? "text-red-600" : "text-slate-500"}`}>
              {err("parentId") ? t(err("parentId")!) : parentHint}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="agNature">
              {t("মূল ধরন *")}
            </label>
            <select
              id="agNature"
              className="input"
              value={effectiveNature}
              onChange={(e) => setNature(e.target.value)}
              disabled={isSystem || !!parent}
              aria-invalid={!!err("nature")}
            >
              {NATURES.map((n) => (
                <option key={n} value={n}>
                  {t(NATURE_LABELS[n])}
                </option>
              ))}
            </select>
            <p className={`mt-1 text-xs ${err("nature") ? "text-red-600" : "text-slate-500"}`}>
              {err("nature") ? t(err("nature")!) : natureHint}
            </p>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="agDescription">
            {t("বিবরণ")}
          </label>
          <textarea
            id="agDescription"
            name="agDescription"
            rows={2}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input"
          />
          {err("description") && <p className="mt-1 text-xs text-red-600">{t(err("description")!)}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-rule pt-3">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {t("বাতিল")}
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? t(isEdit ? "আপডেট হচ্ছে…" : "সংরক্ষণ হচ্ছে…") : t(isEdit ? "আপডেট করুন" : "সংরক্ষণ করুন")}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

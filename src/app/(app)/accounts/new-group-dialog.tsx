"use client";

// "+ নতুন গ্রুপ" popup of the account form: creates an account group without leaving the page.
// Rendered in <body> (portal) — it has its own <form> and must not sit inside the ledger form.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NATURE_LABELS } from "@/lib/accounting";
import { createAccountGroupAction } from "@/server/actions/masters";
import type { GroupOption } from "./account-form";

const NATURES = ["ASSET", "LIABILITY", "INCOME", "EXPENSE", "EQUITY"] as const;
const indent = (depth: number) => (depth > 0 ? `${"   ".repeat(depth)}└ ` : "");

export function NewGroupDialog({ groups, onCancel, onCreated }: { groups: GroupOption[]; onCancel: () => void; onCreated: (g: GroupOption) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [parentId, setParentId] = useState("");
  const [nature, setNature] = useState<string>("EXPENSE");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const parent = groups.find((g) => g.id === parentId);
  const parents = groups.filter((g) => g.canParent);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    ev.stopPropagation(); // never submit the ledger form around this dialog
    const fd = new FormData(ev.currentTarget);
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      const r = await createAccountGroupAction({
        name: String(fd.get("ngName") ?? ""),
        nature: parent ? parent.nature : nature,
        parentId,
        description: String(fd.get("ngDescription") ?? ""),
      });
      if (r.ok) onCreated(r.group);
      else {
        setMessage(r.message);
        setErrors(r.errors ?? {});
      }
    } catch {
      setMessage("সার্ভারে পৌঁছানো যায়নি — আবার চেষ্টা করুন");
    } finally {
      setBusy(false);
    }
  };
  const err = (k: string) => errors[k]?.[0];

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby="ngTitle"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-rule p-0 shadow-2xl backdrop:bg-ink-950/50"
    >
      <form onSubmit={submit} className="space-y-4 p-5" noValidate>
        <h2 id="ngTitle" className="text-base font-bold text-ink-900">নতুন অ্যাকাউন্ট গ্রুপ</h2>
        {message && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
        <div>
          <label className="label" htmlFor="ngName">গ্রুপের নাম *</label>
          <input id="ngName" name="ngName" required maxLength={100} autoFocus className="input" placeholder="যেমন: অফিস খরচ, পরিবহন খরচ" aria-invalid={!!err("name")} />
          {err("name") && <p className="mt-1 text-xs text-red-600">{err("name")}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ngParent">প্যারেন্ট গ্রুপ</label>
            <select id="ngParent" className="input" value={parentId} onChange={(e) => setParentId(e.target.value)} aria-invalid={!!err("parentId")}>
              <option value="">— নেই (মূল গ্রুপ) —</option>
              {parents.map((g) => <option key={g.id} value={g.id}>{indent(g.depth)}{g.name}</option>)}
            </select>
            <p className={`mt-1 text-xs ${err("parentId") ? "text-red-600" : "text-slate-500"}`}>{err("parentId") ?? "ঐচ্ছিক — সাব-গ্রুপ তৈরির জন্য"}</p>
          </div>
          <div>
            <label className="label" htmlFor="ngNature">মূল ধরন *</label>
            <select id="ngNature" className="input" value={parent ? parent.nature : nature} onChange={(e) => setNature(e.target.value)} disabled={!!parent} aria-invalid={!!err("nature")}>
              {NATURES.map((n) => <option key={n} value={n}>{NATURE_LABELS[n]}</option>)}
            </select>
            <p className={`mt-1 text-xs ${err("nature") ? "text-red-600" : "text-slate-500"}`}>{err("nature") ?? (parent ? "প্যারেন্ট গ্রুপের ধরনই প্রযোজ্য" : "সম্পদ / দায় / আয় / ব্যয় / মূলধন")}</p>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ngDescription">বিবরণ</label>
          <textarea id="ngDescription" name="ngDescription" rows={2} maxLength={500} className="input" />
          {err("description") && <p className="mt-1 text-xs text-red-600">{err("description")}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-rule pt-3">
          <button type="button" className="btn-secondary" onClick={onCancel}>বাতিল</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ করুন"}</button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

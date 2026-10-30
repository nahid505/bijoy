"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AccountForm, type GroupOption } from "./account-form";
import { saveAccountAction } from "@/server/actions/masters";
import { useT } from "@/components/lang";

export function NewLedgerDialog({
  groups,
  onClose,
}: {
  groups: GroupOption[];
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby="nlTitle"
      className="fixed inset-0 m-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl backdrop:bg-slate-900/40"
      onCancel={onClose}
    >
      <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
        <div>
          <h2 id="nlTitle" className="text-lg font-bold text-slate-900">
            {t("নতুন হিসাব (লেজার)")}
          </h2>
          <p className="text-xs text-slate-500">
            {t("হিসাবের তথ্য ও ছবি প্রদান করে নতুন লেজার তৈরি করুন")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          aria-label={t("বন্ধ করুন")}
        >
          ✕
        </button>
      </div>
      <AccountForm
        action={saveAccountAction.bind(null, null)}
        groups={groups}
        onCancel={onClose}
      />
    </dialog>,
    document.body
  );
}

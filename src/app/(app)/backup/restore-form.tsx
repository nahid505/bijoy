"use client";

import { startTransition, useActionState, useState } from "react";
import { restoreBackupAction, validateBackupAction, type BackupActionState } from "@/server/actions/backup";
import { ConfirmDialog } from "@/components/forms";

export function RestorePanel() {
  const [file, setFile] = useState<File | null>(null);
  const [vState, validate, validating] = useActionState(validateBackupAction, null as BackupActionState);
  const [rState, restore, restoring] = useActionState(restoreBackupAction, null as BackupActionState);
  const [asking, setAsking] = useState(false);
  const run = (fn: (fd: FormData) => void) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    startTransition(() => fn(fd));
  };
  const report = vState?.report;

  return (
    <div className="space-y-3 p-4 text-sm">
      <p>ব্যাকআপ ফাইল (.json) আপলোড করে প্রথমে <b>যাচাই</b> করুন। রিস্টোর সবসময় একটি <b>নতুন ব্যবসা</b> হিসেবে তৈরি হয় — বর্তমান হিসাব কখনো মুছে বা বদলে যায় না।</p>
      <input type="file" accept="application/json,.json" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-xs" aria-label="ব্যাকআপ ফাইল" />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={!file || validating} onClick={() => run(validate)}>{validating ? "যাচাই হচ্ছে…" : "✓ ব্যাকআপ যাচাই"}</button>
        <button type="button" className="btn-primary" disabled={!file || !report?.ok || restoring} onClick={() => setAsking(true)}>{restoring ? "রিস্টোর হচ্ছে…" : "⟲ নতুন ব্যবসা হিসেবে রিস্টোর"}</button>
      </div>
      {vState?.message && (
        <div role="status" className={`rounded-md px-3 py-2 ${report?.ok ? "bg-brand-50 text-brand-800 ring-1 ring-brand-200" : "bg-red-50 text-red-800 ring-1 ring-red-200"}`}>
          <p className="font-semibold">{vState.message}</p>
          {report && (
            <>
              {report.businessName && <p className="mt-1 text-xs">ব্যবসা: {report.businessName} · ভাউচার {report.stats.vouchers ?? 0} · এন্ট্রি {report.stats.journalEntries ?? 0} · পণ্য {report.stats.products ?? 0}</p>}
              {report.totals && <p className="text-xs">মোট ডেবিট {report.totals.debit} = মোট ক্রেডিট {report.totals.credit}</p>}
              {report.errors.map((e) => <p key={e} className="text-xs">✘ {e}</p>)}
              {report.warnings.map((w) => <p key={w} className="text-xs">⚠ {w}</p>)}
            </>
          )}
        </div>
      )}
      {rState && !rState.ok && rState.message && <p className="rounded-md bg-red-50 px-3 py-2 text-red-800">{rState.message}</p>}
      {asking && <ConfirmDialog
        open={asking}
        title="রিস্টোর নিশ্চিত করুন"
        message="ব্যাকআপটি একটি নতুন ব্যবসা হিসেবে রিস্টোর হবে এবং আপনি সেই ব্যবসার মালিক হবেন। চালিয়ে যাবেন?"
        confirmLabel="রিস্টোর করুন"
        danger={false}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          run(restore);
        }}
      />}
    </div>
  );
}

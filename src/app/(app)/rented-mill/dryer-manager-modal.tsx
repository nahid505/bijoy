"use client";

import { useState, useEffect } from "react";
import { updateDryerNamesAction } from "@/server/actions/rented-mill";

export function DryerManagerModal({
  isOpen,
  onClose,
  currentDryers,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentDryers: string[];
  onSaved: (newDryers: string[]) => void;
}) {
  const [dryers, setDryers] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDryers(
        currentDryers && currentDryers.length > 0
          ? [...currentDryers]
          : ["ডায়ার-১", "ডায়ার-২", "ডায়ার-৩", "ডায়ার-৪"]
      );
      setErrorMsg(null);
    }
  }, [isOpen, currentDryers]);

  if (!isOpen) return null;

  function handleNameChange(idx: number, val: string) {
    const updated = [...dryers];
    updated[idx] = val;
    setDryers(updated);
  }

  function handleAddDryer() {
    const nextNum = dryers.length + 1;
    setDryers([...dryers, `ডায়ার-${nextNum}`]);
  }

  function handleRemoveDryer(idx: number) {
    if (dryers.length <= 1) {
      setErrorMsg("কমপক্ষে একটি ডায়ারের নাম থাকতে হবে।");
      return;
    }
    const updated = dryers.filter((_, i) => i !== idx);
    setDryers(updated);
  }

  async function handleSave() {
    setIsSaving(true);
    setErrorMsg(null);

    const cleaned = dryers.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setErrorMsg("কমপক্ষে একটি ডায়ারের নাম লিখতে হবে।");
      setIsSaving(false);
      return;
    }

    try {
      const res = await updateDryerNamesAction(cleaned);
      if (res.ok) {
        onSaved(res.dryerNames);
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || "ডায়ার তালিকা সংরক্ষণ ব্যর্থ হয়েছে।");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header (Fixed) */}
        <div className="flex shrink-0 items-center justify-between border-b border-rule px-5 py-3.5 sm:px-6 sm:py-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">♨️</span>
            <div>
              <h3 className="text-base font-bold text-ink-900">
                ডায়ার তালিকা ও নাম সম্পাদনা
              </h3>
              <p className="text-[11px] text-slate-500">
                ডায়ারের নাম পরিবর্তন বা নতুন ডায়ার যোগ/বাদ দিন
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6 space-y-3">
          {errorMsg && (
            <div className="rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
              {errorMsg}
            </div>
          )}

          <div className="space-y-2.5">
            {dryers.map((name, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="w-6 text-center text-xs font-bold text-slate-400">
                  {idx + 1}.
                </span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => handleNameChange(idx, e.target.value)}
                  placeholder={`যেমন: ডায়ার-${idx + 1} বা বড় ডায়ার`}
                  className="flex-1 rounded-md border border-rule bg-white px-3 py-1.5 text-xs font-medium text-ink-900 focus:border-brand-500"
                />
                {dryers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveDryer(idx)}
                    title="মুছুন"
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <svg
                      aria-hidden
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={handleAddDryer}
              className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline pt-1"
            >
              <span>➕</span> নতুন ডায়ার যোগ করুন
            </button>
          </div>

          <div className="rounded-lg bg-amber-50/80 border border-amber-200 p-2.5 text-[11px] text-amber-900">
            💡 <b>মনে রাখুন:</b> &ldquo;সরাসরি মিলিং (ডায়ার ছাড়া)&rdquo; অপশনটি সব ড্রপডাউনে স্বয়ংক্রিয়ভাবে স্থায়ীভাবে থাকবে। এখানে শুধু আপনার মিলের প্রকৃত ডায়ারগুলোর নাম লিখবেন।
          </div>
        </div>

        {/* Footer (Fixed) */}
        <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-rule bg-gray-50 px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="btn-outline text-xs"
            disabled={isSaving}
          >
            বাতিল
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="btn-primary text-xs font-semibold"
          >
            {isSaving ? "সংরক্ষণ হচ্ছে..." : "সংরক্ষণ করুন"}
          </button>
        </div>
      </div>
    </div>
  );
}

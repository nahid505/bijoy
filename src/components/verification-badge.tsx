"use client";

import React, { Component, useState, useTransition, type ErrorInfo, type ReactNode } from "react";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/components/lang";
import { verifyVoucherAction } from "@/server/actions/verification";
import type { VerificationStatus } from "@prisma/client";

export interface VerificationBadgeProps {
  voucherId?: string | null;
  status?: VerificationStatus | string | null;
  verifiedBy?: string | { id?: string | null; name?: string | null } | null;
  verifiedAt?: string | Date | null;
  verificationNote?: string | null;
  canVerify?: boolean | null;
  canReject?: boolean | null;
  canUnverify?: boolean | null;
  onStatusChange?: (newStatus: VerificationStatus, note?: string | null) => void;
  compact?: boolean;
}

class BadgeErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("VerificationBadge render error caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] text-slate-500 bg-slate-100">
          —
        </span>
      );
    }
    return this.props.children;
  }
}

function getVerifiedByName(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "object" && val !== null) {
    const obj = val as { name?: string | null };
    return obj.name ? String(obj.name) : null;
  }
  return String(val);
}

function parseSafeDateString(val: string | Date | null | undefined): string {
  if (!val) return "";
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? "" : formatDateTime(val);
  }
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? String(val) : formatDateTime(d);
  } catch {
    return String(val);
  }
}

function VerificationBadgeInner({
  voucherId,
  status: initialStatus = "UNVERIFIED",
  verifiedBy: initialVerifiedBy,
  verifiedAt: initialVerifiedAt,
  verificationNote: initialNote,
  canVerify = false,
  canReject,
  canUnverify,
  onStatusChange,
  compact = false,
}: VerificationBadgeProps) {
  const t = useT();

  const safeInitialStatus: VerificationStatus =
    initialStatus === "VERIFIED" || initialStatus === "REJECTED" ? initialStatus : "UNVERIFIED";
  const [status, setStatus] = useState<VerificationStatus>(safeInitialStatus);
  const [verifiedBy, setVerifiedBy] = useState<string | null>(getVerifiedByName(initialVerifiedBy));
  const [verifiedAt, setVerifiedAt] = useState<string | Date | null>(initialVerifiedAt ?? null);
  const [verificationNote, setVerificationNote] = useState<string | null>(initialNote ? String(initialNote) : null);

  const [isPending, startTransition] = useTransition();
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectNote, setBulkRejectNote] = useState("");
  const [showTooltip, setShowTooltip] = useState(false);

  const userCanVerify = Boolean(canVerify);
  const userCanReject = canReject !== undefined ? Boolean(canReject) : userCanVerify;
  const userCanUnverify = canUnverify !== undefined ? Boolean(canUnverify) : userCanVerify;

  const handleVerify = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!voucherId || isPending) return;

    // Optimistic UI
    const prevStatus = status;
    setStatus("VERIFIED");
    setVerifiedAt(new Date());

    startTransition(async () => {
      const res = await verifyVoucherAction({ voucherId, status: "VERIFIED" });
      if (!res.ok) {
        setStatus(prevStatus);
        alert(res.message || "ভেরিফিকেশন ব্যর্থ হয়েছে");
      } else {
        if (res.verifiedBy) setVerifiedBy(getVerifiedByName(res.verifiedBy));
        if (res.verifiedAt) setVerifiedAt(res.verifiedAt);
        onStatusChange?.("VERIFIED");
      }
    });
  };

  const handleRejectConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!voucherId || isPending) return;

    const note = rejectNote.trim();
    setShowRejectModal(false);

    // Optimistic UI
    const prevStatus = status;
    const prevNote = verificationNote;
    setStatus("REJECTED");
    setVerificationNote(note || null);
    setVerifiedAt(new Date());

    startTransition(async () => {
      const res = await verifyVoucherAction({ voucherId, status: "REJECTED", note });
      if (!res.ok) {
        setStatus(prevStatus);
        setVerificationNote(prevNote);
        alert(res.message || "বাতিলকরণ ব্যর্থ হয়েছে");
      } else {
        if (res.verifiedBy) setVerifiedBy(getVerifiedByName(res.verifiedBy));
        if (res.verifiedAt) setVerifiedAt(res.verifiedAt);
        onStatusChange?.("REJECTED", note);
      }
    });
  };

  const handleUnverify = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!voucherId || isPending) return;

    // Optimistic UI
    const prevStatus = status;
    setStatus("UNVERIFIED");
    setVerifiedBy(null);
    setVerifiedAt(null);
    setVerificationNote(null);

    startTransition(async () => {
      const res = await verifyVoucherAction({ voucherId, status: "UNVERIFIED" });
      if (!res.ok) {
        setStatus(prevStatus);
        alert(res.message || "ভেরিফিকেশন প্রত্যাহার ব্যর্থ হয়েছে");
      } else {
        onStatusChange?.("UNVERIFIED");
      }
    });
  };

  const formattedDate = parseSafeDateString(verifiedAt);

  return (
    <div className="relative inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {/* ── Visual Badge ── */}
      <div
        className="relative group cursor-pointer"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {status === "VERIFIED" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-2xs">
            <span className="text-emerald-600">🛡️</span>
            <span>{t("অনুমোদিত")}</span>
            <span className="text-[10px] text-emerald-700 font-bold" title={t("লক করা (Tamper-proof)")}>🔒</span>
          </span>
        )}

        {status === "UNVERIFIED" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
            <span className="text-amber-600 text-[11px]">⏳</span>
            <span>{t("অপেক্ষমাণ")}</span>
          </span>
        )}

        {status === "REJECTED" && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-300">
            <span className="text-rose-600">✕</span>
            <span>{t("রিজেক্টেড")}</span>
          </span>
        )}

        {/* ── Hover Popover / Tooltip ── */}
        {showTooltip && (
          <div className="absolute left-0 bottom-full mb-1.5 z-50 w-56 rounded-lg bg-slate-900 text-white text-xs p-2.5 shadow-xl border border-slate-700 animate-in fade-in zoom-in-95 pointer-events-none">
            {status === "VERIFIED" ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-emerald-400 font-semibold">
                  <span>🛡️</span>
                  <span>{t("অনুমোদিত লেনদেন (Verified)")}</span>
                </div>
                {verifiedBy && (
                  <p className="text-slate-300">
                    {t("যাচাইকারী")}: <span className="text-white font-medium">{String(verifiedBy)}</span>
                  </p>
                )}
                {formattedDate && (
                  <p className="text-slate-400 text-[11px]">
                    {t("তারিখ")}: {formattedDate}
                  </p>
                )}
                {verificationNote && (
                  <p className="text-amber-300 text-[11px] pt-0.5 border-t border-slate-800">
                    {t("নোট")}: {String(verificationNote)}
                  </p>
                )}
                <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-800">
                  🔒 {t("এটি সুরক্ষিত ও লক করা — কোনো সাধারণ ব্যবহারকারী পরিবর্তন করতে পারবে না")}
                </p>
              </div>
            ) : status === "REJECTED" ? (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-rose-400 font-semibold">
                  <span>✕</span>
                  <span>{t("বাতিলকৃত লেনদেন (Rejected)")}</span>
                </div>
                {verifiedBy && (
                  <p className="text-slate-300">
                    {t("বাতিল করেছেন")}: <span className="text-white font-medium">{String(verifiedBy)}</span>
                  </p>
                )}
                {formattedDate && (
                  <p className="text-slate-400 text-[11px]">
                    {t("তারিখ")}: {formattedDate}
                  </p>
                )}
                <p className="text-rose-300 text-[11px] pt-0.5 border-t border-slate-800">
                  {t("কারণ")}: {verificationNote ? String(verificationNote) : t("কোনো কারণ উল্লেখ করা হয়নি")}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-amber-400 font-semibold">
                  <span>⏳</span>
                  <span>{t("অপেক্ষমাণ লেনদেন (Pending)")}</span>
                </div>
                <p className="text-slate-300 text-[11px]">
                  {t("লেনদেনটি এখনো মালিক বা ভেরিফায়ার দ্বারা যাচাই ও অনুমোদন করা হয়নি।")}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Micro-Interaction Action Buttons (Only for authorized users) ── */}
      {voucherId && (userCanVerify || userCanReject || userCanUnverify) && (
        <div className="inline-flex items-center gap-1 ml-1 print:hidden">
          {status === "UNVERIFIED" && (
            <>
              {userCanVerify && (
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={isPending}
                  className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 transition-colors shadow-2xs text-xs font-bold disabled:opacity-50"
                  title={t("এক ক্লিকে অনুমোদন (Verify)")}
                >
                  ✓
                </button>
              )}
              {userCanReject && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowRejectModal(true);
                  }}
                  disabled={isPending}
                  className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-rose-100 hover:bg-rose-200 text-rose-800 border border-rose-300 transition-colors shadow-2xs text-xs font-bold disabled:opacity-50"
                  title={t("রিজেক্ট করুন (Reject with note)")}
                >
                  ✕
                </button>
              )}
            </>
          )}

          {status === "VERIFIED" && userCanUnverify && (
            <button
              type="button"
              onClick={handleUnverify}
              disabled={isPending}
              className="text-[11px] text-slate-500 hover:text-amber-800 hover:underline px-1 py-0.5 rounded transition-colors"
              title={t("ভেরিফিকেশন প্রত্যাহার ও আনলক করুন (Unverify / Re-open)")}
            >
              {t("ফিরিয়ে নিন")}
            </button>
          )}

          {status === "REJECTED" && (
            <>
              {userCanVerify && (
                <button
                  type="button"
                  onClick={handleVerify}
                  disabled={isPending}
                  className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-300 transition-colors"
                  title={t("পুনরায় অনুমোদন করুন (Re-approve)")}
                >
                  {t("অনুমোদন")}
                </button>
              )}
              {userCanUnverify && (
                <button
                  type="button"
                  onClick={handleUnverify}
                  disabled={isPending}
                  className="text-[11px] text-slate-500 hover:text-amber-800 hover:underline px-1 py-0.5 rounded transition-colors"
                  title={t("পুনরায় চালু করুন (Re-open / Unverify)")}
                >
                  {t("পুনরায় চালু")}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Reject Modal / Prompt ── */}
      {showRejectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          onClick={(e) => {
            e.stopPropagation();
            setShowRejectModal(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-ink-900 flex items-center gap-1.5 text-rose-700">
                <span>✕</span>
                <span>{t("লেনদেন বাতিল / রিজেক্ট")}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowRejectModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRejectConfirm} className="pt-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t("বাতিলের কারণ বা নোট (ঐচ্ছিক)")}
                </label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setBulkRejectNote(e.target.value)}
                  placeholder={t("যেমন: টাকার পরিমাণে অমিল, অপ্রয়োজনীয় এন্ট্রি ইত্যাদি...")}
                  className="input w-full text-xs p-2.5 h-20 resize-none border border-slate-300 focus:border-rose-500 rounded-md"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRejectModal(false)}
                  className="btn-ghost text-xs px-3 py-1.5"
                >
                  {t("বাতিল")}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn-danger text-xs px-3.5 py-1.5 font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-xs disabled:opacity-50"
                >
                  {isPending ? t("প্রক্রিয়াকরণ...") : t("রিজেক্ট নিশ্চিত করুন")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function VerificationBadge(props: VerificationBadgeProps) {
  return (
    <BadgeErrorBoundary>
      <VerificationBadgeInner {...props} />
    </BadgeErrorBoundary>
  );
}

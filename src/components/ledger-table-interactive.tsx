"use client";

import React, { Component, useMemo, useState, useTransition, type ErrorInfo, type ReactNode } from "react";
import Link from "next/link";
import { formatDate, formatDrCr, formatMoney, toBnDigits } from "@/lib/format";
import { useT } from "@/components/lang";
import { VerificationBadge } from "@/components/verification-badge";
import { bulkVerifyVouchersAction } from "@/server/actions/verification";
import type { ReportResult, ReportRow } from "@/server/reports/types";
import type { VerificationStatus } from "@prisma/client";

const ROW_CLASS: Record<string, string> = {
  normal: "",
  group: "font-bold bg-slate-100/70 border-y border-rule",
  subtotal: "font-semibold bg-slate-50 border-t border-rule",
  total: "font-bold bg-slate-100 border-t-2 border-ink-900",
  detail: "text-xs text-slate-600",
};

export interface LedgerTableInteractiveProps {
  report?: ReportResult | null;
  currency?: string;
  canVerify?: boolean | null;
  currentUserName?: string | null;
}

export class LedgerErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Ledger rendering error caught by LedgerErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="p-4 my-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
            <p className="font-semibold flex items-center gap-2">
              <span>⚠️</span>
              <span>লেনদেন তালিকা লোড করতে সাময়িক সমস্যা হয়েছে</span>
            </p>
            <p className="text-xs text-amber-700 mt-1">
              কিছু তথ্যে অমিল বা অনুপস্থিত ফিল্ড রয়েছে। অনুগ্রহ করে পেজটি রিফ্রেশ করুন।
            </p>
          </div>
        )
      );
    }
    return this.props.children;
  }
}

// ── Helpers for Null Safety ──

function extractStatus(cells: Record<string, any> | undefined, overrideStatus?: VerificationStatus): VerificationStatus {
  if (overrideStatus === "VERIFIED" || overrideStatus === "REJECTED" || overrideStatus === "UNVERIFIED") {
    return overrideStatus;
  }
  const raw = cells?.verificationStatus ?? cells?.verification_status ?? (cells?.is_verified ? "VERIFIED" : undefined);
  if (raw === "VERIFIED" || raw === "REJECTED") {
    return raw;
  }
  return "UNVERIFIED";
}

function extractVerifiedByName(cells: Record<string, any> | undefined, overrideVerifiedBy?: string | null): string | null {
  if (overrideVerifiedBy !== undefined) return overrideVerifiedBy;
  const raw = cells?.verifiedBy ?? cells?.verified_by;
  if (!raw) return null;
  if (typeof raw === "object" && raw !== null) {
    return raw.name ? String(raw.name) : null;
  }
  return String(raw);
}

function extractVerifiedAt(cells: Record<string, any> | undefined): string | null {
  const raw = cells?.verifiedAt ?? cells?.verified_at;
  if (!raw) return null;
  return raw instanceof Date ? raw.toISOString() : String(raw);
}

function extractVerificationNote(cells: Record<string, any> | undefined, overrideNote?: string | null): string | null {
  if (overrideNote !== undefined) return overrideNote;
  const raw = cells?.verificationNote ?? cells?.verification_note;
  if (!raw) return null;
  return String(raw);
}

function extractVoucherId(r: ReportRow | undefined): string | undefined {
  const id = r?.cells?.voucherId ?? (r?.cells as any)?.voucher_id;
  return id ? String(id) : undefined;
}

function LedgerTableInteractiveInner({
  report,
  currency = "৳",
  canVerify = false,
  currentUserName,
}: LedgerTableInteractiveProps) {
  const t = useT();
  const [isPending, startTransition] = useTransition();

  const userCanVerify = Boolean(canVerify);
  const rows = report?.rows ?? [];

  // Track status updates optimistically
  const [rowStatusOverrides, setRowStatusOverrides] = useState<Record<string, { status: VerificationStatus; note?: string | null; verifiedBy?: string | null }>>({});

  // Checkbox selection for bulk verification
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bulk reject modal state
  const [showBulkRejectModal, setShowBulkRejectModal] = useState(false);
  const [bulkRejectNote, setBulkRejectNote] = useState("");

  // Extract transaction rows with voucherId
  const transactionRows = useMemo(() => {
    return rows.filter((r) => {
      if (!r || !r.cells) return false;
      const isGroup = r.kind === "group";
      const isTotal = r.kind === "total";
      const vId = extractVoucherId(r);
      return !isGroup && !isTotal && Boolean(r.cells.voucher) && Boolean(vId);
    });
  }, [rows]);

  const allVoucherIds = useMemo(() => {
    return transactionRows.map((r) => extractVoucherId(r)!).filter(Boolean);
  }, [transactionRows]);

  const isAllSelected = allVoucherIds.length > 0 && allVoucherIds.every((id) => selectedIds.has(id));

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVoucherIds));
    }
  };

  const handleToggleSelect = (voucherId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(voucherId)) {
        next.delete(voucherId);
      } else {
        next.add(voucherId);
      }
      return next;
    });
  };

  const handleBulkAction = (status: VerificationStatus, note?: string | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0 || isPending) return;

    // Optimistic UI updates
    setRowStatusOverrides((prev) => {
      const updated = { ...prev };
      for (const id of ids) {
        updated[id] = {
          status,
          note: note ?? null,
          verifiedBy: status === "UNVERIFIED" ? null : currentUserName ?? "অ্যাডমিন",
        };
      }
      return updated;
    });

    startTransition(async () => {
      const res = await bulkVerifyVouchersAction({
        voucherIds: ids,
        status,
        note,
      });

      if (!res.ok) {
        alert(res.message || "বাল্ক অ্যাকশন সম্পন্ন করা সম্ভব হয়নি");
      } else {
        setSelectedIds(new Set());
      }
    });
  };

  const handleBulkRejectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShowBulkRejectModal(false);
    handleBulkAction("REJECTED", bulkRejectNote.trim());
    setBulkRejectNote("");
  };

  const getBadgeClass = (rawType: string, label: string) => {
    const tLower = (rawType || label || "").toLowerCase();
    if (tLower.includes("sales") || tLower.includes("বিক্রয়")) {
      return "bg-emerald-100 text-emerald-800 border border-emerald-300";
    }
    if (tLower.includes("purchase") || tLower.includes("ক্রয়")) {
      return "bg-blue-100 text-blue-800 border border-blue-300";
    }
    if (tLower.includes("receipt") || tLower.includes("আদায়") || tLower.includes("প্রাপ্তি")) {
      return "bg-green-100 text-green-800 border border-green-300";
    }
    if (tLower.includes("payment") || tLower.includes("পরিশোধ")) {
      return "bg-amber-100 text-amber-800 border border-amber-300";
    }
    if (tLower.includes("return") || tLower.includes("ফেরত")) {
      return "bg-purple-100 text-purple-800 border border-purple-300";
    }
    return "bg-slate-100 text-slate-800 border border-slate-300";
  };

  // ── Desktop Table ──
  const desktopTable = (
    <div className="overflow-x-auto hidden md:block print:block">
      <table className="table">
        <thead>
          <tr>
            {userCanVerify && (
              <th className="w-10 text-center print:hidden">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={handleToggleSelectAll}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4"
                  title={t("সব বাছাই করুন")}
                />
              </th>
            )}
            <th>{t("তারিখ")}</th>
            <th>{t("ভাউচার")}</th>
            <th>{t("ধরন")}</th>
            <th>{t("এন্ট্রি করেছেন")}</th>
            <th className="num">{t("ডেবিট")}</th>
            <th className="num">{t("ক্রেডিট")}</th>
            <th className="num">{t("ব্যালেন্স")}</th>
            <th className="text-center print:text-left">{t("যাচাই অবস্থা")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (!r || !r.cells) return null;
            const isGroup = r.kind === "group";
            const isTotal = r.kind === "total";
            const voucherId = extractVoucherId(r);
            const isSelectable = !isGroup && !isTotal && Boolean(voucherId);
            const isSelected = voucherId ? selectedIds.has(voucherId) : false;

            const override = voucherId ? rowStatusOverrides[voucherId] : undefined;
            const currentStatus = extractStatus(r.cells, override?.status);
            const verifiedBy = extractVerifiedByName(r.cells, override?.verifiedBy);
            const verifiedAt = extractVerifiedAt(r.cells);
            const verificationNote = extractVerificationNote(r.cells, override?.note);

            const debit = typeof r.cells.debit === "number" ? r.cells.debit : null;
            const credit = typeof r.cells.credit === "number" ? r.cells.credit : null;
            const balance = typeof r.cells.balance === "number" ? r.cells.balance : null;

            return (
              <tr
                key={i}
                className={`${ROW_CLASS[r.kind ?? "normal"]} ${isSelected ? "bg-amber-50/70" : ""}`}
              >
                {userCanVerify && (
                  <td className="w-10 text-center print:hidden">
                    {isSelectable && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => handleToggleSelect(voucherId!, e as any)}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4"
                      />
                    )}
                  </td>
                )}
                <td className="whitespace-nowrap">
                  {r.cells.date instanceof Date
                    ? formatDate(r.cells.date)
                    : typeof r.cells.date === "string"
                    ? formatDate(r.cells.date)
                    : isGroup
                    ? t("প্রারম্ভিক")
                    : ""}
                </td>
                <td>
                  {r.href && r.cells.voucher ? (
                    <Link
                      prefetch={false}
                      href={r.href}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {String(r.cells.voucher)}
                    </Link>
                  ) : (
                    String(r.cells.voucher || "")
                  )}
                </td>
                <td>{String(r.cells.type || "")}</td>
                <td className="text-xs text-slate-600">{String(r.cells.createdBy || "")}</td>
                <td className="num dr">{debit !== null ? formatMoney(debit, currency) : ""}</td>
                <td className="num cr">{credit !== null ? formatMoney(credit, currency) : ""}</td>
                <td className={`num ${balance !== null ? (balance > 0 ? "dr" : balance < 0 ? "cr" : "") : ""}`}>
                  {balance !== null ? formatDrCr(balance, currency) : ""}
                </td>
                <td className="text-center print:text-left">
                  {isSelectable ? (
                    <VerificationBadge
                      voucherId={voucherId}
                      status={currentStatus}
                      verifiedBy={verifiedBy}
                      verifiedAt={verifiedAt}
                      verificationNote={verificationNote}
                      canVerify={userCanVerify}
                      onStatusChange={(newSt, note) => {
                        if (voucherId) {
                          setRowStatusOverrides((prev) => ({
                            ...prev,
                            [voucherId]: { status: newSt, note, verifiedBy: currentUserName ?? "অ্যাডমিন" },
                          }));
                        }
                      }}
                    />
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  // ── Mobile Responsive View ──
  const mobileRows = rows.filter((r) => r && r.cells && r.kind !== "total");
  const totalRow = rows.find((r) => r?.kind === "total");
  const groupRow = rows.find((r) => r?.kind === "group");

  const entriesCount = transactionRows.length;
  const totalCredit =
    totalRow && typeof totalRow.cells?.credit === "number"
      ? totalRow.cells.credit
      : transactionRows.reduce((s, r) => s + (typeof r?.cells?.credit === "number" ? r.cells.credit : 0), 0);

  const totalDebit =
    totalRow && typeof totalRow.cells?.debit === "number"
      ? totalRow.cells.debit
      : transactionRows.reduce((s, r) => s + (typeof r?.cells?.debit === "number" ? r.cells.debit : 0), 0);

  const closing =
    totalRow && typeof totalRow.cells?.balance === "number"
      ? totalRow.cells.balance
      : rows.length > 0 && typeof rows[rows.length - 1]?.cells?.balance === "number"
      ? (rows[rows.length - 1].cells.balance as number)
      : groupRow && typeof groupRow.cells?.balance === "number"
      ? groupRow.cells.balance
      : 0;

  const isZero = Math.abs(closing) < 0.005;
  const statusLabel = isZero ? t("সমান") : closing > 0 ? t("পাওনা") : t("দেনা");
  const statusCls = isZero
    ? "bg-slate-100 text-slate-700 ring-slate-300"
    : closing > 0
    ? "bg-emerald-50 text-emerald-800 ring-emerald-300"
    : "bg-red-50 text-red-800 ring-red-300";

  return (
    <>
      {desktopTable}

      {/* ── Mobile Responsive View: Compact 2-row transaction cards ── */}
      <div className="block md:hidden print:hidden" id="mobile-ledger-view">
        {userCanVerify && transactionRows.length > 0 && (
          <div className="bg-slate-100/90 px-4 py-2 border-b border-gray-200 flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={handleToggleSelectAll}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4"
              />
              <span>{t("সব বাছাই করুন")}</span>
            </label>
            {selectedIds.size > 0 && (
              <span className="text-brand-700 font-semibold">
                {selectedIds.size} {t("টি নির্বাচিত")}
              </span>
            )}
          </div>
        )}

        <div className="divide-y divide-gray-200">
          {mobileRows.map((r, i) => {
            if (!r || !r.cells) return null;
            const isOpening = r.kind === "group";
            const voucherId = extractVoucherId(r);
            const isSelectable = !isOpening && Boolean(voucherId);
            const isSelected = voucherId ? selectedIds.has(voucherId) : false;

            const override = voucherId ? rowStatusOverrides[voucherId] : undefined;
            const currentStatus = extractStatus(r.cells, override?.status);
            const verifiedBy = extractVerifiedByName(r.cells, override?.verifiedBy);
            const verifiedAt = extractVerifiedAt(r.cells);
            const verificationNote = extractVerificationNote(r.cells, override?.note);

            const rawType = String(r.cells.rawType ?? (isOpening ? "OPENING" : ""));
            const typeLabelText = isOpening ? t("প্রারম্ভিক") : String(r.cells.type || t(rawType) || "");
            const dateText =
              r.cells.date instanceof Date
                ? formatDate(r.cells.date)
                : typeof r.cells.date === "string"
                ? formatDate(r.cells.date)
                : isOpening
                ? t("প্রারম্ভিক ব্যালেন্স")
                : "";
            const credit = typeof r.cells.credit === "number" ? r.cells.credit : 0;
            const debit = typeof r.cells.debit === "number" ? r.cells.debit : 0;
            const balance = typeof r.cells.balance === "number" ? r.cells.balance : null;
            const against = r.cells.against ? String(r.cells.against) : "";
            const voucher = r.cells.voucher && !isOpening ? String(r.cells.voucher) : "";
            const createdBy = r.cells.createdBy ? String(r.cells.createdBy) : (isOpening ? t("সিস্টেম") : "");

            return (
              <div
                key={i}
                className={`border-b border-gray-200 py-3.5 px-4 transition-colors ${
                  isSelected ? "bg-amber-50/70" : "odd:bg-white even:bg-gray-50/60"
                }`}
              >
                <div className="space-y-2">
                  {/* Line 1: Checkbox + Type Badge + Date (left) | Debit/Credit (right) */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {userCanVerify && isSelectable && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => handleToggleSelect(voucherId!, e as any)}
                          className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer h-4 w-4 shrink-0"
                        />
                      )}
                      <span
                        className={`inline-block shrink-0 rounded px-2.5 py-1 text-sm font-semibold uppercase leading-none ${getBadgeClass(
                          rawType,
                          typeLabelText
                        )}`}
                      >
                        {typeLabelText}
                      </span>
                      <span className="text-sm font-medium text-gray-800 truncate">{dateText}</span>
                    </div>
                    <div className="text-right shrink-0">
                      {credit > 0 ? (
                        <span className="text-base font-semibold tabular-nums text-emerald-700">
                          +{formatMoney(credit, currency)}
                        </span>
                      ) : debit > 0 ? (
                        <span className="text-base font-semibold tabular-nums text-red-600">
                          −{formatMoney(debit, currency)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Line 2: Against + Voucher Code + CreatedBy (left) | Running Balance Dr/Cr (right) */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 min-w-0">
                      {against && <span className="font-medium text-sm text-gray-700 truncate max-w-[130px]">{against}</span>}
                      {voucher && (
                        <Link
                          prefetch={false}
                          href={r.href ?? "#"}
                          className="font-mono font-semibold text-sm text-amber-600 hover:underline"
                        >
                          {voucher}
                        </Link>
                      )}
                      {createdBy && <span className="text-sm font-semibold text-emerald-700">{createdBy}</span>}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-bold tabular-nums text-lg text-gray-900 whitespace-nowrap">
                        {balance !== null ? formatDrCr(balance, currency) : ""}
                      </span>
                    </div>
                  </div>

                  {/* Line 3: Verification Badge & Actions on Mobile */}
                  {isSelectable && (
                    <div className="pt-1 border-t border-gray-100 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500">{t("যাচাই অবস্থা")}:</span>
                      <VerificationBadge
                        voucherId={voucherId}
                        status={currentStatus}
                        verifiedBy={verifiedBy}
                        verifiedAt={verifiedAt}
                        verificationNote={verificationNote}
                        canVerify={userCanVerify}
                        compact
                        onStatusChange={(newSt, note) => {
                          if (voucherId) {
                            setRowStatusOverrides((prev) => ({
                              ...prev,
                              [voucherId]: { status: newSt, note, verifiedBy: currentUserName ?? "অ্যাডমিন" },
                            }));
                          }
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Fixed/Floating Summary Bar at Bottom ── */}
        <div className="sticky bottom-0 z-20 mt-3 border-t-2 border-ink-600 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2 border-b border-rule/70 pb-2.5">
            <div className="flex items-center gap-2 font-bold text-ink-900">
              <span className="rounded bg-ink-800 px-2.5 py-1 text-sm text-white tabular-nums">
                [{toBnDigits(entriesCount)}]
              </span>
              <span className="text-base font-bold">{t("মোট")}</span>
            </div>
            <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 ring-1 ring-inset tabular-nums ${statusCls}`}>
              <span className="text-sm font-semibold">{statusLabel}</span>
              <span className="text-xl font-extrabold">{formatDrCr(closing, currency)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2.5">
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 border border-gray-200">
              <span className="text-sm font-medium text-gray-700">{t("মোট জমা")}</span>
              <span className="text-base font-bold tabular-nums text-emerald-700">
                {formatMoney(totalCredit, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 border border-gray-200">
              <span className="text-sm font-medium text-gray-700">{t("মোট খরচ")}</span>
              <span className="text-base font-bold tabular-nums text-red-600">
                {formatMoney(totalDebit, currency)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Floating Bulk Action Toolbar (When 1 or more items are selected) ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl flex flex-wrap items-center justify-center gap-3 animate-in fade-in slide-in-from-bottom-5 border border-slate-700/80 max-w-[95vw]">
          <div className="flex items-center gap-2 shrink-0">
            <span className="bg-emerald-600 text-white font-bold text-xs px-2.5 py-1 rounded-full tabular-nums">
              {selectedIds.size}
            </span>
            <span className="text-xs sm:text-sm font-medium text-slate-200">
              {t("টি লেনদেন নির্বাচিত")}
            </span>
          </div>

          <div className="h-4 w-px bg-slate-700 hidden sm:block shrink-0" />

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleBulkAction("VERIFIED")}
              disabled={isPending}
              className="btn-primary bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3.5 py-1.5 font-bold flex items-center gap-1.5 rounded-lg shadow-xs disabled:opacity-50 cursor-pointer"
              title={t("নির্বাচিত সব লেনদেন একসাথে অনুমোদন")}
            >
              <span>✓</span>
              <span>{t("একসাথে অনুমোদন (Verify)")}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowBulkRejectModal(true)}
              disabled={isPending}
              className="btn-danger bg-rose-600 hover:bg-rose-500 text-white text-xs px-3 py-1.5 font-bold flex items-center gap-1.5 rounded-lg shadow-xs disabled:opacity-50 cursor-pointer"
              title={t("নির্বাচিত সব লেনদেন একসাথে বাতিল")}
            >
              <span>✕</span>
              <span>{t("রিজেক্ট")}</span>
            </button>

            <button
              type="button"
              onClick={() => handleBulkAction("UNVERIFIED")}
              disabled={isPending}
              className="btn-secondary bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 font-medium rounded-lg border border-slate-700 disabled:opacity-50 cursor-pointer"
              title={t("পুনরায় অপেক্ষমাণ করুন (Reset to Pending)")}
            >
              <span>🔄</span>
              <span>{t("অপেক্ষমাণ")}</span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-slate-400 hover:text-white px-2 py-1 underline cursor-pointer"
            >
              {t("বাছাই বাতিল")}
            </button>
          </div>
        </div>
      )}

      {/* ── Bulk Reject Modal ── */}
      {showBulkRejectModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4"
          onClick={() => setShowBulkRejectModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200 text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-ink-900 flex items-center gap-1.5 text-rose-700">
                <span>✕</span>
                <span>{t("একসাথে {0} টি লেনদেন রিজেক্ট", { 0: selectedIds.size })}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowBulkRejectModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleBulkRejectSubmit} className="pt-3 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {t("বাতিলের কারণ বা অডিট নোট (ঐচ্ছিক)")}
                </label>
                <textarea
                  value={bulkRejectNote}
                  onChange={(e) => setBulkRejectNote(e.target.value)}
                  placeholder={t("যেমন: ভুল এন্ট্রি, বাল্ক অডিট বাতিল ইত্যাদি...")}
                  className="input w-full text-xs p-2.5 h-20 resize-none border border-slate-300 focus:border-rose-500 rounded-md"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBulkRejectModal(false)}
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
    </>
  );
}

export function LedgerTableInteractive(props: LedgerTableInteractiveProps) {
  return (
    <LedgerErrorBoundary>
      <LedgerTableInteractiveInner {...props} />
    </LedgerErrorBoundary>
  );
}

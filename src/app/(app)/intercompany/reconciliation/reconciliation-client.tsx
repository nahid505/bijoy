"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate, formatMoney, toBnDigits } from "@/lib/format";
import { useT } from "@/components/lang";
import {
  acceptIntercompanyPurchaseAction,
  disputeIntercompanyPurchaseAction,
  loadContraLedgerAction,
} from "@/server/actions/intercompany";

export interface ReconciliationRecord {
  id: string;
  voucherNo: string;
  type: string;
  date: Date;
  amount: number;
  subtotal: number;
  isSales: boolean;
  sellerName: string;
  buyerName: string;
  partnerBusinessId: string | null;
  bilateralStatus: "NONE" | "PENDING" | "ACCEPTED" | "DISPUTED";
  disputeReason: string | null;
  intercompanyRefId: string | null;
  canAccept: boolean;
  canDispute: boolean;
  items: Array<{
    productName: string;
    quantity: number;
    unitName: string;
    rate: number;
    amount: number;
  }>;
}

export interface SisterConcernOption {
  id: string;
  name: string;
  intercompanyCode: string | null;
  isParent: boolean;
}

export interface WarehouseOption {
  id: string;
  name: string;
  isDefault: boolean;
}

interface ReconciliationClientProps {
  initialSummary: {
    total: number;
    pending: number;
    accepted: number;
    disputed: number;
    totalVolume: number;
  };
  initialRecords: ReconciliationRecord[];
  sisterConcerns: SisterConcernOption[];
  warehouses: WarehouseOption[];
  activeBusinessId: string;
  currency?: string;
}

export function ReconciliationClient({
  initialSummary,
  initialRecords,
  sisterConcerns,
  warehouses,
  activeBusinessId,
  currency = "৳",
}: ReconciliationClientProps) {
  const t = useT();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"proposals" | "contra">("proposals");
  const [records, setRecords] = useState<ReconciliationRecord[]>(initialRecords);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [directionFilter, setDirectionFilter] = useState<string>("ALL");
  const [isPending, startTransition] = useTransition();

  // Accept Modal state
  const [acceptTarget, setAcceptTarget] = useState<ReconciliationRecord | null>(null);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(
    warehouses.find((w) => w.isDefault)?.id || warehouses[0]?.id || ""
  );

  // Dispute Modal state
  const [disputeTarget, setDisputeTarget] = useState<ReconciliationRecord | null>(null);
  const [disputeReason, setDisputeReason] = useState<string>("");
  const [modalError, setModalError] = useState<string | null>(null);

  // Expanded items state
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Contra Ledger state
  const otherEntities = sisterConcerns.filter((s) => s.id !== activeBusinessId);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>(
    otherEntities[0]?.id || ""
  );
  const [contraData, setContraData] = useState<any | null>(null);
  const [contraLoading, setContraLoading] = useState<boolean>(false);
  const [contraError, setContraError] = useState<string | null>(null);

  // Load contra ledger
  const fetchContraLedger = async (partnerId: string) => {
    if (!partnerId) return;
    setContraLoading(true);
    setContraError(null);
    try {
      const data = await loadContraLedgerAction(activeBusinessId, partnerId);
      setContraData(data);
    } catch (err: any) {
      setContraError(err?.message || "কন্ট্রা লেজার লোড করতে সমস্যা হয়েছে");
    } finally {
      setContraLoading(false);
    }
  };

  const handleTabChange = (tab: "proposals" | "contra") => {
    setActiveTab(tab);
    if (tab === "contra" && !contraData && selectedPartnerId) {
      fetchContraLedger(selectedPartnerId);
    }
  };

  // Filter records
  const filteredRecords = records.filter((r) => {
    if (statusFilter !== "ALL" && r.bilateralStatus !== statusFilter) return false;
    if (directionFilter === "SALES" && !r.isSales) return false;
    if (directionFilter === "PURCHASE" && r.isSales) return false;
    return true;
  });

  // Handle Accept Submit
  const handleAcceptSubmit = async () => {
    if (!acceptTarget) return;
    setModalError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("voucherId", acceptTarget.id);
      if (selectedWarehouseId) fd.set("warehouseId", selectedWarehouseId);

      const res = await acceptIntercompanyPurchaseAction(null, fd);
      if (res?.ok) {
        setAcceptTarget(null);
        router.refresh();
      } else {
        setModalError(res?.message || "অনুমোদন ব্যর্থ হয়েছে");
      }
    });
  };

  // Handle Dispute Submit
  const handleDisputeSubmit = async () => {
    if (!disputeTarget) return;
    if (!disputeReason.trim()) {
      setModalError("সংশোধন অনুরোধের কারণ লিখুন");
      return;
    }
    setModalError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("voucherId", disputeTarget.id);
      fd.set("reason", disputeReason.trim());

      const res = await disputeIntercompanyPurchaseAction(null, fd);
      if (res?.ok) {
        setDisputeTarget(null);
        setDisputeReason("");
        router.refresh();
      } else {
        setModalError(res?.message || "অনুরোধ পাঠাতে ব্যর্থ হয়েছে");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* ── Summary Stats ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="panel p-4 border-l-4 border-brand-500">
          <div className="text-xs font-medium text-slate-500">{t("মোট আন্তঃপ্রতিষ্ঠান চালান")}</div>
          <div className="mt-1 text-2xl font-bold text-ink-900">{toBnDigits(initialSummary.total)}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {t("ভলিউম")}: {currency} {formatMoney(initialSummary.totalVolume)}
          </div>
        </div>

        <div className="panel p-4 border-l-4 border-amber-500">
          <div className="text-xs font-medium text-amber-700">{t("অপেক্ষমাণ প্রস্তাবনা (Pending)")}</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">{toBnDigits(initialSummary.pending)}</div>
          <div className="mt-0.5 text-xs text-slate-500">{t("ক্রেতার অনুমোদনের অপেক্ষায়")}</div>
        </div>

        <div className="panel p-4 border-l-4 border-emerald-500">
          <div className="text-xs font-medium text-emerald-700">{t("অনুমোদিত ও স্টক ইন (Accepted)")}</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{toBnDigits(initialSummary.accepted)}</div>
          <div className="mt-0.5 text-xs text-slate-500">{t("সমন্বয় ও পোস্টিং সম্পন্ন")}</div>
        </div>

        <div className="panel p-4 border-l-4 border-rose-500">
          <div className="text-xs font-medium text-rose-700">{t("সংশোধন অনুরোধ (Disputed)")}</div>
          <div className="mt-1 text-2xl font-bold text-rose-600">{toBnDigits(initialSummary.disputed)}</div>
          <div className="mt-0.5 text-xs text-slate-500">{t("পুনর্বিবেচনা প্রয়োজন")}</div>
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => handleTabChange("proposals")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
            activeTab === "proposals"
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-brand-500" />
          {t("আন্তঃপ্রতিষ্ঠান চালান ও ক্রয় প্রস্তাবনা")}
          <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {toBnDigits(filteredRecords.length)}
          </span>
        </button>

        <button
          onClick={() => handleTabChange("contra")}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
            activeTab === "contra"
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
          {t("দ্বিপাক্ষিক খতিয়ান ট্র্যাকার (Contra Ledger)")}
        </button>
      </div>

      {/* ── Tab 1: Proposals & Invoices ── */}
      {activeTab === "proposals" && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <span>{t("স্ট্যাটাস")}:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 focus:border-brand-500 focus:outline-none"
                >
                  <option value="ALL">{t("সকল স্ট্যাটাস")}</option>
                  <option value="PENDING">{t("অপেক্ষমাণ (PENDING)")}</option>
                  <option value="ACCEPTED">{t("অনুমোদিত (ACCEPTED)")}</option>
                  <option value="DISPUTED">{t("সংশোধন অনুরোধ (DISPUTED)")}</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <span>{t("লেনদেনের ধরন")}:</span>
                <select
                  value={directionFilter}
                  onChange={(e) => setDirectionFilter(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 focus:border-brand-500 focus:outline-none"
                >
                  <option value="ALL">{t("সকল লেনদেন")}</option>
                  <option value="SALES">{t("আমাদের বিক্রয় (প্রেরিত)")}</option>
                  <option value="PURCHASE">{t("আমাদের ক্রয় (প্রাপ্ত প্রস্তাবনা)")}</option>
                </select>
              </div>
            </div>

            <div className="text-xs text-slate-500">
              {t("মোট")} <span className="font-semibold text-slate-700">{toBnDigits(filteredRecords.length)}</span> {t("টি চালান")}
            </div>
          </div>

          {/* Proposals Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 font-semibold">
                <tr>
                  <th className="px-4 py-3">{t("তারিখ ও চালান নং")}</th>
                  <th className="px-4 py-3">{t("বিক্রেতা প্রতিষ্ঠান")}</th>
                  <th className="px-4 py-3">{t("ক্রেতা প্রতিষ্ঠান")}</th>
                  <th className="px-4 py-3 text-right">{t("টাকার পরিমাণ")}</th>
                  <th className="px-4 py-3 text-center">{t("দ্বিপাক্ষিক অবস্থা")}</th>
                  <th className="px-4 py-3 text-center">{t("কার্যক্রম / অ্যাকশন")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-slate-400">
                      {t("কোনো আন্তঃপ্রতিষ্ঠান চালান পাওয়া যায়নি")}
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((r) => {
                    const isExpanded = expandedRow === r.id;
                    return (
                      <React.Fragment key={r.id}>
                        <tr className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-medium">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setExpandedRow(isExpanded ? null : r.id)}
                                className="text-slate-400 hover:text-brand-600 font-mono text-sm"
                                title={t("আইটেম বিবরণ")}
                              >
                                {isExpanded ? "▼" : "▶"}
                              </button>
                              <Link
                                href={`/vouchers/v/${r.id}`}
                                className="font-semibold text-brand-600 hover:underline"
                              >
                                {r.voucherNo}
                              </Link>
                            </div>
                            <div className="text-[11px] text-slate-400 ml-4">{formatDate(r.date)}</div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-medium text-ink-900">{r.sellerName}</div>
                            {r.isSales && (
                              <span className="inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 font-medium">
                                {t("আমরা বিক্রেতা")}
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-medium text-ink-900">{r.buyerName}</div>
                            {!r.isSales && (
                              <span className="inline-block rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-700 font-medium">
                                {t("আমরা ক্রেতা")}
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-right font-semibold text-ink-900">
                            {currency} {formatMoney(r.amount)}
                            <div className="text-[10px] text-slate-400">
                              {toBnDigits(r.items.length)} {t("আইটেম")}
                            </div>
                          </td>

                          <td className="px-4 py-3 text-center">
                            {r.bilateralStatus === "PENDING" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 border border-amber-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                                {t("অপেক্ষমাণ (Pending)")}
                              </span>
                            )}
                            {r.bilateralStatus === "ACCEPTED" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                {t("অনুমোদিত (Accepted)")}
                              </span>
                            )}
                            {r.bilateralStatus === "DISPUTED" && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 border border-rose-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                {t("সংশোধন অনুরোধ (Disputed)")}
                              </span>
                            )}
                            {r.disputeReason && (
                              <div className="mt-1 text-[11px] text-rose-600 max-w-[200px] truncate" title={r.disputeReason}>
                                ⚠️ {r.disputeReason}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              {r.canAccept && (
                                <button
                                  onClick={() => {
                                    setAcceptTarget(r);
                                    setModalError(null);
                                  }}
                                  className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 transition"
                                >
                                  {t("অনুমোদন করুন")}
                                </button>
                              )}

                              {r.canDispute && (
                                <button
                                  onClick={() => {
                                    setDisputeTarget(r);
                                    setDisputeReason("");
                                    setModalError(null);
                                  }}
                                  className="rounded bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition"
                                >
                                  {t("সংশোধন অনুরোধ")}
                                </button>
                              )}

                              {!r.canAccept && !r.canDispute && (
                                <Link
                                  href={`/vouchers/v/${r.id}`}
                                  className="text-xs text-slate-500 hover:text-brand-600 underline font-medium"
                                >
                                  {t("বিস্তারিত")}
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Collapsible item details */}
                        {isExpanded && (
                          <tr className="bg-slate-50/70">
                            <td colSpan={6} className="px-6 py-3 border-t border-slate-100">
                              <div className="text-xs font-semibold text-slate-600 mb-2">
                                {t("চালানের অন্তর্ভুক্ত আইটেমসমূহ:")}
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                {r.items.map((it, idx) => (
                                  <div
                                    key={idx}
                                    className="rounded border border-slate-200 bg-white p-2.5 shadow-2xs text-xs"
                                  >
                                    <div className="font-semibold text-ink-900">{it.productName}</div>
                                    <div className="flex justify-between text-slate-500 mt-1">
                                      <span>
                                        {toBnDigits(it.quantity)} {it.unitName} × {currency} {formatMoney(it.rate)}
                                      </span>
                                      <span className="font-semibold text-slate-800">
                                        {currency} {formatMoney(it.amount)}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 2: Bilateral Contra Ledger ── */}
      {activeTab === "contra" && (
        <div className="space-y-5">
          {/* Partner Selector */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-xs font-semibold text-slate-700">
              {t("সিস্টার কনসার্ন নির্বাচন করুন:")}
            </span>
            <select
              value={selectedPartnerId}
              onChange={(e) => {
                setSelectedPartnerId(e.target.value);
                fetchContraLedger(e.target.value);
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 focus:border-brand-500 focus:outline-none"
            >
              {otherEntities.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.intercompanyCode ? `[${s.intercompanyCode}]` : ""} {s.isParent ? "(Parent)" : ""}
                </option>
              ))}
            </select>

            <button
              onClick={() => fetchContraLedger(selectedPartnerId)}
              disabled={contraLoading}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {contraLoading ? t("লোড হচ্ছে...") : t("রিফ্রেশ করুন")}
            </button>
          </div>

          {contraError && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
              {contraError}
            </div>
          )}

          {contraData && (
            <div className="space-y-6">
              {/* Variance Status Banner */}
              <div
                className={`flex flex-col sm:flex-row items-center justify-between gap-4 rounded-lg border p-4 ${
                  contraData.isReconciled
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold ${
                      contraData.isReconciled ? "bg-emerald-200 text-emerald-800" : "bg-amber-200 text-amber-800"
                    }`}
                  >
                    {contraData.isReconciled ? "✓" : "!"}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">
                      {contraData.isReconciled
                        ? t("দ্বিপাক্ষিক হিসাব সম্পূর্ণ মিলেছে (Balanced & Reconciled)")
                        : t("দ্বিপাক্ষিক হিসাবে অমিল রয়েছে (Variance Detected)")}
                    </h3>
                    <p className="text-xs opacity-90 mt-0.5">
                      {contraData.isReconciled
                        ? t("উভয় প্রতিষ্ঠানের দেনা ও পাওনার ব্যালেন্স সমান এবং সমান্তরাল রয়েছে।")
                        : t("অনুমোদন অপেক্ষমাণ চালান বা সমন্বয়ের কারণে পার্থক্য হতে পারে।")}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs font-medium opacity-75">{t("পার্থক্য / অমিল (Variance)")}</div>
                  <div className="text-xl font-bold font-mono">
                    {currency} {formatMoney(contraData.variance)}
                  </div>
                </div>
              </div>

              {/* Intercompany Exposure & Credit Limit Banner */}
              {contraData.exposure && contraData.exposure.limit > 0 && (
                <div
                  className={`p-3 rounded-lg border flex flex-wrap items-center justify-between gap-2 text-xs ${
                    contraData.exposure.isOverLimit
                      ? "bg-red-50 border-red-200 text-red-900 font-semibold"
                      : "bg-sky-50 border-sky-200 text-sky-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{contraData.exposure.isOverLimit ? "⚠️" : "🛡️"}</span>
                    <div>
                      <span className="font-bold">{t("আন্তঃপ্রতিষ্ঠান ক্রেডিট লিমিট ও এক্সপোজার")}: </span>
                      <span>
                        বর্তমান বাকি {currency} {formatMoney(contraData.exposure.currentDue)} / অনুমোদিত সীমা {currency} {formatMoney(contraData.exposure.limit)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/80 border border-slate-200">
                      ব্যবহার: {toBnDigits(contraData.exposure.utilizationPct)}%
                    </span>
                    {contraData.exposure.isOverLimit && (
                      <span className="font-bold bg-red-600 text-white px-2 py-0.5 rounded text-[10px]">
                        {t("সীমা অতিক্রান্ত!")}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Dual Ledger Summaries */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Entity A Side */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
                  <div className="border-b border-slate-100 pb-2 mb-3">
                    <span className="text-xs font-bold text-slate-500 uppercase">{t("আমাদের প্রতিষ্ঠান")}</span>
                    <h4 className="text-base font-bold text-ink-900">{contraData.entityA.name}</h4>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">{t("মোট ডেবিট")}:</span>
                      <div className="font-semibold text-slate-800 mt-0.5">
                        {currency} {formatMoney(contraData.entityA.totalDebit)}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">{t("মোট ক্রেডিট")}:</span>
                      <div className="font-semibold text-slate-800 mt-0.5">
                        {currency} {formatMoney(contraData.entityA.totalCredit)}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">{t("নিট ব্যালেন্স")}:</span>
                      <div className="font-bold text-brand-600 mt-0.5">
                        {currency} {formatMoney(contraData.entityA.netBalance)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Entity B Side */}
                <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-2xs">
                  <div className="border-b border-slate-100 pb-2 mb-3">
                    <span className="text-xs font-bold text-slate-500 uppercase">{t("সিস্টার কনসার্ন")}</span>
                    <h4 className="text-base font-bold text-ink-900">{contraData.entityB.name}</h4>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">{t("মোট ডেবিট")}:</span>
                      <div className="font-semibold text-slate-800 mt-0.5">
                        {currency} {formatMoney(contraData.entityB.totalDebit)}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">{t("মোট ক্রেডিট")}:</span>
                      <div className="font-semibold text-slate-800 mt-0.5">
                        {currency} {formatMoney(contraData.entityB.totalCredit)}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">{t("নিট ব্যালেন্স")}:</span>
                      <div className="font-bold text-brand-600 mt-0.5">
                        {currency} {formatMoney(contraData.entityB.netBalance)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transactions Breakdown */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <h4 className="text-sm font-bold text-slate-800 mb-3">
                  {t("খতিয়ান লেনদেন বিবরণ (Journal Entries Breakdown)")}
                </h4>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-xs text-left">
                    <thead className="bg-slate-50 font-semibold text-slate-600">
                      <tr>
                        <th className="px-3 py-2">{t("তারিখ")}</th>
                        <th className="px-3 py-2">{t("চালান নং")}</th>
                        <th className="px-3 py-2">{t("বিবরণ")}</th>
                        <th className="px-3 py-2 text-right">{t("ডেবিট (৳)")}</th>
                        <th className="px-3 py-2 text-right">{t("ক্রেডিট (৳)")}</th>
                        <th className="px-3 py-2 text-center">{t("স্ট্যাটাস")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {contraData.entriesA.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-4 text-center text-slate-400">
                            {t("কোনো লেনদেন রেকর্ড নেই")}
                          </td>
                        </tr>
                      ) : (
                        contraData.entriesA.map((ent: any) => (
                          <tr key={ent.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-medium">{formatDate(ent.date)}</td>
                            <td className="px-3 py-2 font-semibold text-brand-600">{ent.voucherNo}</td>
                            <td className="px-3 py-2 text-slate-500">{ent.narration || "-"}</td>
                            <td className="px-3 py-2 text-right font-medium text-ink-900">
                              {ent.debit > 0 ? formatMoney(ent.debit) : "-"}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-ink-900">
                              {ent.credit > 0 ? formatMoney(ent.credit) : "-"}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                                {ent.bilateralStatus || "POSTED"}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Accept Confirmation Modal ── */}
      {acceptTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-ink-900">
              {t("আন্তঃপ্রতিষ্ঠান ক্রয় অনুমোদন ও স্টক গ্রহণ")}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {t("চালান নং:")} <span className="font-semibold text-brand-600">{acceptTarget.voucherNo}</span> |{" "}
              {t("বিক্রেতা:")} <span className="font-semibold text-slate-700">{acceptTarget.sellerName}</span>
            </p>

            <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">{t("মোট টাকার পরিমাণ")}:</span>
                <span className="font-bold text-ink-900">
                  {currency} {formatMoney(acceptTarget.amount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t("আইটেম সংখ্যা")}:</span>
                <span className="font-medium text-slate-700">{toBnDigits(acceptTarget.items.length)} টি</span>
              </div>
            </div>

            {/* Warehouse select */}
            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t("পণ্য প্রবেশের গুদাম (Warehouse)")}:
              </label>
              <select
                value={selectedWarehouseId}
                onChange={(e) => setSelectedWarehouseId(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-brand-500 focus:outline-none"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {w.isDefault ? `(${t("ডিফল্ট")})` : ""}
                  </option>
                ))}
              </select>
            </div>

            {modalError && (
              <div className="mt-3 rounded bg-rose-50 border border-rose-200 p-2 text-xs text-rose-700">
                {modalError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAcceptTarget(null)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                {t("বাতিল")}
              </button>
              <button
                type="button"
                onClick={handleAcceptSubmit}
                disabled={isPending}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {isPending ? t("অনুমোদন হচ্ছে...") : t("নিশ্চিত করুন (Accept & Stock In)")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dispute Modal ── */}
      {disputeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-2xs">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-rose-700">
              {t("আন্তঃপ্রতিষ্ঠান চালান সংশোধন অনুরোধ (Dispute)")}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {t("চালান নং:")} <span className="font-semibold text-brand-600">{disputeTarget.voucherNo}</span> |{" "}
              {t("বিক্রেতা:")} <span className="font-semibold text-slate-700">{disputeTarget.sellerName}</span>
            </p>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {t("সংশোধন অনুরোধের কারণ বা বিবরণ লিখুন")} <span className="text-rose-500">*</span>:
              </label>
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                placeholder={t("যেমন: পণ্য ঘাটতি পাওয়া গেছে, অথবা দরে অমিল রয়েছে...")}
                rows={3}
                className="w-full rounded-md border border-slate-300 p-2.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-rose-500 focus:outline-none"
              />
            </div>

            {modalError && (
              <div className="mt-3 rounded bg-rose-50 border border-rose-200 p-2 text-xs text-rose-700">
                {modalError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDisputeTarget(null)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                {t("বাতিল")}
              </button>
              <button
                type="button"
                onClick={handleDisputeSubmit}
                disabled={isPending}
                className="rounded-md bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
              >
                {isPending ? t("পাঠানো হচ্ছে...") : t("সংশোধন অনুরোধ পাঠান")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

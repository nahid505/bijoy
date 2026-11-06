"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { useT } from "@/components/lang";

const BADGE_TONES = {
  green: "bg-brand-50 text-brand-800 ring-brand-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
};

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${BADGE_TONES[tone]}`}>{children}</span>;
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

function EmptyState({ message }: { message?: string }) {
  return <div className="px-6 py-10 text-center text-sm text-slate-400">{message || "কোনো তথ্য পাওয়া যায়নি"}</div>;
}
import {
  createCompanyGroupAction,
  assignBusinessToGroupAction,
  removeBusinessFromGroupAction,
  createGroupRoleAction,
  assignUserToGroupAction,
  removeUserFromGroupAction,
  unlinkSisterConcernPartnerAction,
} from "@/server/actions/company-group";

interface Props {
  currentBusiness: {
    id: string;
    name: string;
    isOwner: boolean;
    isSuperAdmin: boolean;
  };
  groupData: {
    inGroup: boolean;
    group: { id: string; name: string; code: string | null } | null;
    sisterConcerns: Array<{
      id: string;
      name: string;
      businessType: string | null;
      isParent: boolean;
      intercompanyCode: string | null;
      mobile: string | null;
      email: string | null;
    }>;
  };
  overview: {
    group: { id: string; name: string; code: string | null; description: string | null };
    totalEntities: number;
    entities: Array<any>;
  } | null;
  roles: Array<{
    id: string;
    groupId: string;
    name: string;
    description: string | null;
    permissions: string[];
    _count: { memberships: number };
  }>;
  members: Array<{
    id: string;
    role: { id: string; name: string };
    user: { id: string; name: string; email: string | null; mobile: string | null; isActive: boolean };
  }>;
  partners: {
    customers: Array<any>;
    suppliers: Array<any>;
  };
  existingGroups: Array<{
    id: string;
    name: string;
    code: string | null;
    description: string | null;
    _count: { businesses: number };
  }>;
  availableBusinesses: Array<{
    id: string;
    name: string;
    groupId: string | null;
    isParent: boolean;
    intercompanyCode: string | null;
    businessType: string | null;
  }>;
  availableUsers: Array<{
    id: string;
    name: string;
    email: string | null;
    mobile: string | null;
  }>;
}

export function GroupClient({
  currentBusiness,
  groupData,
  overview,
  roles,
  members,
  partners,
  existingGroups,
  availableBusinesses,
  availableUsers,
}: Props) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<"OVERVIEW" | "SISTERS" | "IAM" | "PARTNERS">("OVERVIEW");
  const [isPending, startTransition] = useTransition();
  const [showNewRoleForm, setShowNewRoleForm] = useState(false);
  const [showAddSisterForm, setShowAddSisterForm] = useState(false);
  const [showAssignUserForm, setShowAssignUserForm] = useState(false);

  const currentConcern = groupData.sisterConcerns.find((s) => s.id === currentBusiness.id);

  return (
    <div className="space-y-6">
      {/* ── Status Banner ── */}
      <div className="rounded-2xl border border-indigo-200 bg-linear-to-r from-indigo-50/90 via-white to-blue-50/70 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🏢</span>
              <h2 className="text-xl font-bold text-ink-950">
                {groupData.inGroup ? groupData.group?.name : t("কোনো গ্রুপে যুক্ত নেই")}
              </h2>
              {groupData.inGroup && currentConcern?.isParent && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 ring-1 ring-amber-300">
                  {t("প্যারেন্ট হোল্ডিং প্রতিষ্ঠান")}
                </span>
              )}
            </div>
            <p className="text-xs sm:text-sm text-slate-600">
              {groupData.inGroup
                ? `${t("গ্রুপ কোড:")} ${groupData.group?.code || "N/A"} • ${groupData.sisterConcerns.length} ${t("টি সিস্টার কনসার্ন সংযুক্ত")}`
                : t("মাল্টি-এনটিটি ইআরপি সুবিধা ব্যবহার করতে প্রতিষ্ঠানটিকে একটি এন্টারপ্রাইজ গ্রুপে যুক্ত করুন")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/reports/consolidated"
              className="btn-secondary !text-xs !py-1.5 flex items-center gap-1.5"
            >
              <span>📊</span>
              <span>{t("সম্মিলিত গ্রুপ রিপোর্ট")}</span>
            </Link>
            <Link
              href="/intercompany/reconciliation"
              className="btn-secondary !text-xs !py-1.5 flex items-center gap-1.5"
            >
              <span>⚖️</span>
              <span>{t("দ্বিপাক্ষিক রিকনসিলিয়েশন")}</span>
            </Link>
            <Link
              href="/intercompany/fund-transfer"
              className="btn-secondary !text-xs !py-1.5 flex items-center gap-1.5"
            >
              <span>💸</span>
              <span>{t("তহবিল স্থানান্তর")}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="flex border-b border-rule gap-1 overflow-x-auto text-sm">
        <button
          onClick={() => setActiveTab("OVERVIEW")}
          className={`px-4 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === "OVERVIEW"
              ? "border-brand-600 text-brand-600 font-bold"
              : "border-transparent text-slate-600 hover:text-ink-900"
          }`}
        >
          {t("গ্রুপ তথ্য ও প্রোফাইল")}
        </button>
        <button
          onClick={() => setActiveTab("SISTERS")}
          className={`px-4 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === "SISTERS"
              ? "border-brand-600 text-brand-600 font-bold"
              : "border-transparent text-slate-600 hover:text-ink-900"
          }`}
        >
          <span>{t("সিস্টার কনসার্ন তালিকা")}</span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.2 text-[11px] font-bold text-slate-600">
            {groupData.sisterConcerns.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("IAM")}
          className={`px-4 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === "IAM"
              ? "border-brand-600 text-brand-600 font-bold"
              : "border-transparent text-slate-600 hover:text-ink-900"
          }`}
        >
          <span>{t("সেন্ট্রাল আইএএম (Group Roles)")}</span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.2 text-[11px] font-bold text-slate-600">
            {members.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("PARTNERS")}
          className={`px-4 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            activeTab === "PARTNERS"
              ? "border-brand-600 text-brand-600 font-bold"
              : "border-transparent text-slate-600 hover:text-ink-900"
          }`}
        >
          <span>{t("ইন্টার-কোম্পানি পার্টনার")}</span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.2 text-[11px] font-bold text-slate-600">
            {partners.customers.length + partners.suppliers.length}
          </span>
        </button>
      </div>

      {/* ── TAB 1: OVERVIEW ── */}
      {activeTab === "OVERVIEW" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {groupData.inGroup ? (
              <section className="panel p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-ink-900">{t("গ্রুপ প্রোফাইল")}</h3>
                  <Badge tone="blue">{groupData.group?.code || "NO_CODE"}</Badge>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="rounded-lg bg-slate-50 p-3 border border-rule">
                    <span className="text-slate-500 block mb-1">{t("গ্রুপের নাম")}</span>
                    <span className="text-sm font-bold text-ink-900">{groupData.group?.name}</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 border border-rule">
                    <span className="text-slate-500 block mb-1">{t("সিস্টার কনসার্ন সংখ্যা")}</span>
                    <span className="text-sm font-bold text-ink-900">{groupData.sisterConcerns.length} টি প্রতিষ্ঠান</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 border border-rule">
                    <span className="text-slate-500 block mb-1">{t("আপনার প্রতিষ্ঠানের কোড")}</span>
                    <span className="text-sm font-bold text-ink-900">{currentConcern?.intercompanyCode || "N/A"}</span>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 border border-rule">
                    <span className="text-slate-500 block mb-1">{t("প্রতিষ্ঠানের ভূমিকা")}</span>
                    <span className="text-sm font-bold text-ink-900">
                      {currentConcern?.isParent ? t("প্যারেন্ট (মূল হোল্ডিং)") : t("সাবসিডিয়ারি / সিস্টার কনসার্ন")}
                    </span>
                  </div>
                </div>

                {overview?.group.description && (
                  <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-rule">
                    {overview.group.description}
                  </p>
                )}

                {(currentBusiness.isOwner || currentBusiness.isSuperAdmin) && (
                  <div className="pt-4 border-t border-rule flex justify-between items-center">
                    <span className="text-xs text-slate-500">
                      {t("গ্রুপ থেকে এই প্রতিষ্ঠানটি বিচ্ছিন্ন করতে চান?")}
                    </span>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        if (confirm(t("আপনি কি নিশ্চিত এই প্রতিষ্ঠানকে গ্রুপ থেকে বাদ দিতে চান?"))) {
                          startTransition(async () => {
                            await removeBusinessFromGroupAction(currentBusiness.id);
                          });
                        }
                      }}
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                    >
                      {t("গ্রুপ থেকে বাদ দিন")}
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <div className="space-y-6">
                {/* Create New Group Form */}
                <section className="panel p-5 space-y-4">
                  <h3 className="text-base font-bold text-ink-900 flex items-center gap-2">
                    <span>✨</span>
                    <span>{t("নতুন কোম্পানি গ্রুপ তৈরি করুন")}</span>
                  </h3>
                  <p className="text-xs text-slate-600">
                    {t("একটি হোল্ডিং বা কর্পোরেট গ্রুপ তৈরি করুন। বর্তমান প্রতিষ্ঠানটি স্বয়ংক্রিয়ভাবে প্যারেন্ট হিসেবে যুক্ত হবে।")}
                  </p>
                  <ActionForm action={createCompanyGroupAction}>
                    <input type="hidden" name="parentBusinessId" value={currentBusiness.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="গ্রুপের নাম *" name="name">
                        <input
                          name="name"
                          className="input"
                          required
                          placeholder={t("যেমন: রহিম গ্রুপ অব ইন্ডাস্ট্রিজ")}
                        />
                      </Field>
                      <Field label="গ্রুপ কোড (ঐচ্ছিক)" name="code" hint="অনন্য সংক্ষিপ্ত কোড (e.g. RAHIM_GROUP)">
                        <input
                          name="code"
                          className="input"
                          placeholder="RAHIM_GROUP"
                        />
                      </Field>
                      <Field label="বিবরণ" name="description" className="sm:col-span-2">
                        <textarea
                          name="description"
                          rows={2}
                          className="input"
                          placeholder={t("গ্রুপের কার্যপরিধি বা সংক্ষিপ্ত বিবরণ...")}
                        />
                      </Field>
                    </div>
                    <div className="mt-4">
                      <SubmitButton>{t("গ্রুপ তৈরি করুন")}</SubmitButton>
                    </div>
                  </ActionForm>
                </section>

                {/* Join Existing Group Form */}
                {existingGroups.length > 0 && (
                  <section className="panel p-5 space-y-4">
                    <h3 className="text-base font-bold text-ink-900 flex items-center gap-2">
                      <span>🔗</span>
                      <span>{t("বিদ্যমান কোম্পানি গ্রুপে যুক্ত হোন")}</span>
                    </h3>
                    <ActionForm action={assignBusinessToGroupAction}>
                      <input type="hidden" name="businessId" value={currentBusiness.id} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="কোম্পানি গ্রুপ নির্বাচন করুন *" name="groupId">
                          <select name="groupId" className="input" required>
                            <option value="">{t("-- গ্রুপ বেছে নিন --")}</option>
                            {existingGroups.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.name} ({g.code || "NO_CODE"}) — {g._count.businesses} {t("টি প্রতিষ্ঠান")}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="আন্তঃপ্রতিষ্ঠান কোড" name="intercompanyCode" hint="যেমন: MILL, DEPOT, TRADING">
                          <input
                            name="intercompanyCode"
                            className="input"
                            placeholder="MILL"
                          />
                        </Field>
                        <div className="sm:col-span-2 flex items-center gap-2 pt-1">
                          <input
                            type="checkbox"
                            id="isParentJoin"
                            name="isParent"
                            className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                          <label htmlFor="isParentJoin" className="text-xs font-semibold text-slate-700 cursor-pointer">
                            {t("এই প্রতিষ্ঠানটিকে গ্রুপের প্যারেন্ট (মূল হোল্ডিং) হিসেবে নির্ধারণ করুন")}
                          </label>
                        </div>
                      </div>
                      <div className="mt-4">
                        <SubmitButton>{t("গ্রুপে যুক্ত হোন")}</SubmitButton>
                      </div>
                    </ActionForm>
                  </section>
                )}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <section className="panel p-5 space-y-3">
              <h4 className="text-sm font-bold text-ink-900 flex items-center gap-1.5">
                <span>💡</span>
                <span>{t("মাল্টি-এনটিটি ERP কী সুবিধা দেয়?")}</span>
              </h4>
              <ul className="text-xs text-slate-600 space-y-2 list-disc pl-4">
                <li>
                  <strong className="text-slate-800">{t("মিরর ভাউচার:")}</strong> {t("এক সিস্টার কনসার্নে বিক্রয় চালান তৈরি করলে স্বয়ংক্রিয়ভাবে অন্য কনসার্নে ড্রাফট পারচেজ প্রস্তাবনা তৈরি হয়।")}
                </li>
                <li>
                  <strong className="text-slate-800">{t("১-ক্লিক ফান্ড ট্রান্সফার:")}</strong> {t("দ্বিপাক্ষিক ডেবিট/ক্রেডিট ভাউচারসহ ঋণ ও অগ্রিম অর্থ স্থানান্তর।")}
                </li>
                <li>
                  <strong className="text-slate-800">{t("কনসোলিডেটেড রিপোর্ট:")}</strong> {t("আইএফআরএস ১০ নির্দেশিকা অনুযায়ী অবিক্রীত মজুদের অপ্রাপ্ত মুনাফা ও অভ্যন্তরীণ দেনা-পাওনা সমন্বিত গ্রুপ ব্যালেন্স শিট।")}
                </li>
                <li>
                  <strong className="text-slate-800">{t("সেন্ট্রাল গ্রুপ আইএএম:")}</strong> {t("Group CFO বা Group Auditor-কে এক ক্লিকে সব সিস্টার কনসার্নে নজরদারির সুযোগ।")}
                </li>
              </ul>
            </section>
          </div>
        </div>
      )}

      {/* ── TAB 2: SISTER CONCERNS ── */}
      {activeTab === "SISTERS" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-ink-900">{t("সিস্টার কনসার্ন তালিকা")}</h3>
              <p className="text-xs text-slate-500">{t("গ্রুপের আওতাধীন সকল ব্যবসায়িক প্রতিষ্ঠানের তালিকা ও আন্তঃপ্রতিষ্ঠান কোড")}</p>
            </div>
            {groupData.inGroup && (currentBusiness.isOwner || currentBusiness.isSuperAdmin) && (
              <button
                type="button"
                onClick={() => setShowAddSisterForm(!showAddSisterForm)}
                className="btn !text-xs !py-1.5 flex items-center gap-1.5"
              >
                <span>➕</span>
                <span>{showAddSisterForm ? t("ফর্ম লুকান") : t("নতুন সিস্টার কনসার্ন যুক্ত করুন")}</span>
              </button>
            )}
          </div>

          {showAddSisterForm && groupData.inGroup && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 shadow-xs">
              <h4 className="text-xs font-bold uppercase tracking-wider text-brand-900 mb-3">
                {t("গ্রুপে সিস্টার কনসার্ন সংযুক্তকরণ")}
              </h4>
              <ActionForm action={assignBusinessToGroupAction}>
                <input type="hidden" name="groupId" value={groupData.group!.id} />
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="প্রতিষ্ঠান নির্বাচন করুন *" name="businessId">
                    <select name="businessId" className="input" required>
                      <option value="">{t("-- প্রতিষ্ঠান বেছে নিন --")}</option>
                      {availableBusinesses
                        .filter((b) => b.groupId !== groupData.group!.id)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name} {b.businessType ? `(${b.businessType})` : ""}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="আন্তঃপ্রতিষ্ঠান কোড *" name="intercompanyCode" hint="যেমন: MILL, DEPOT">
                    <input name="intercompanyCode" className="input" required placeholder="DEPOT" />
                  </Field>
                  <Field label="মালিকানা শেয়ার (%)" name="ownershipPercentage" hint="NCI হিসাব (ডিফল্ট: 100%)">
                    <input type="number" step="0.01" min="0" max="100" defaultValue="100" name="ownershipPercentage" className="input" />
                  </Field>
                  <Field label="ক্রেডিট লিমিট (৳)" name="intercompanyCreditLimit" hint="বাকি/এক্সপোজার সীমা">
                    <input type="number" step="1000" min="0" placeholder="যেমন: 500000" name="intercompanyCreditLimit" className="input" />
                  </Field>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" id="isParentNew" name="isParent" className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                  <label htmlFor="isParentNew" className="text-xs font-semibold text-slate-700 cursor-pointer">
                    {t("প্যারেন্ট হোল্ডিং")}
                  </label>
                </div>
                <div className="mt-3 flex gap-2">
                  <SubmitButton>{t("সংযুক্ত করুন")}</SubmitButton>
                  <button type="button" onClick={() => setShowAddSisterForm(false)} className="btn-secondary !text-xs">
                    {t("বাতিল")}
                  </button>
                </div>
              </ActionForm>
            </div>
          )}

          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("প্রতিষ্ঠানের নাম")}</th>
                  <th>{t("আন্তঃপ্রতিষ্ঠান কোড")}</th>
                  <th>{t("ধরন")}</th>
                  <th>{t("স্ট্যাটাস ও ভূমিকা")}</th>
                  <th>{t("যোগাযোগ")}</th>
                  <th className="text-right">{t("পদক্ষেপ")}</th>
                </tr>
              </thead>
              <tbody>
                {groupData.sisterConcerns.map((s) => (
                  <tr key={s.id} className={s.id === currentBusiness.id ? "bg-amber-50/50" : ""}>
                    <td className="font-semibold text-ink-900">
                      <div className="flex items-center gap-2">
                        <span>{s.name}</span>
                        {s.id === currentBusiness.id && <Badge tone="amber">{t("বর্তমান")}</Badge>}
                      </div>
                    </td>
                    <td>
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                        {s.intercompanyCode || "-"}
                      </span>
                    </td>
                    <td>
                      <span className="text-xs text-slate-600">{s.businessType || t("জেনারেল")}</span>
                    </td>
                    <td>
                      {s.isParent ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800">
                          <span>🏛️</span> {t("প্যারেন্ট")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {t("সাবসিডিয়ারি")}
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-slate-600">
                      {s.mobile || s.email || "-"}
                    </td>
                    <td className="text-right">
                      {s.id !== currentBusiness.id && (currentBusiness.isOwner || currentBusiness.isSuperAdmin) && (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => {
                            if (confirm(`আপনি কি "${s.name}" কে গ্রুপ থেকে বাদ দিতে চান?`)) {
                              startTransition(async () => {
                                await removeBusinessFromGroupAction(s.id);
                              });
                            }
                          }}
                          className="text-xs font-semibold text-rose-600 hover:text-rose-800"
                        >
                          {t("বাদ দিন")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      {/* ── TAB 3: GROUP IAM ── */}
      {activeTab === "IAM" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-ink-900">{t("সেন্ট্রাল গ্রুপ আইএএম ও রোল ব্যবস্থাপনা")}</h3>
              <p className="text-xs text-slate-500">{t("গ্রুপের সকল কোম্পানিতে নিরীক্ষা ও আর্থিক নিয়ন্ত্রণের জন্য সেন্ট্রাল রোল")}</p>
            </div>
            {groupData.inGroup && (currentBusiness.isOwner || currentBusiness.isSuperAdmin) && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewRoleForm(!showNewRoleForm)}
                  className="btn-secondary !text-xs !py-1.5"
                >
                  {showNewRoleForm ? t("রোল ফর্ম বন্ধ") : t("+ নতুন গ্রুপ রোল")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAssignUserForm(!showAssignUserForm)}
                  className="btn !text-xs !py-1.5"
                >
                  {showAssignUserForm ? t("ফর্ম বন্ধ") : t("+ সেন্ট্রাল মেম্বার নিযুক্ত করুন")}
                </button>
              </div>
            )}
          </div>

          {/* New Group Role Form */}
          {showNewRoleForm && groupData.inGroup && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 shadow-xs">
              <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900 mb-3">
                {t("নতুন সেন্ট্রাল গ্রুপ রোল তৈরি")}
              </h4>
              <ActionForm action={createGroupRoleAction}>
                <input type="hidden" name="groupId" value={groupData.group!.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="রোলের নাম *" name="name" hint="e.g. GROUP_CFO, GROUP_AUDITOR">
                    <input name="name" className="input" required placeholder="GROUP_CFO" />
                  </Field>
                  <Field label="বিবরণ" name="description">
                    <input name="description" className="input" placeholder={t("গ্রুপ চিফ ফাইন্যান্সিয়াল অফিসার")} />
                  </Field>
                  <Field label="অনুমতি (কমা দিয়ে পৃথক করুন)" name="permissions" className="sm:col-span-2" hint="যেমন: *, reports:view, vouchers:view, accounts:view">
                    <input name="permissions" defaultValue="*" className="input" placeholder="*, reports:view, vouchers:view" />
                  </Field>
                </div>
                <div className="mt-3 flex gap-2">
                  <SubmitButton>{t("রোল সংরক্ষণ করুন")}</SubmitButton>
                  <button type="button" onClick={() => setShowNewRoleForm(false)} className="btn-secondary !text-xs">
                    {t("বাতিল")}
                  </button>
                </div>
              </ActionForm>
            </div>
          )}

          {/* Assign User Form */}
          {showAssignUserForm && groupData.inGroup && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-xs">
              <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-900 mb-3">
                {t("ব্যবহারকারীকে গ্রুপ রোল প্রদান")}
              </h4>
              <ActionForm action={assignUserToGroupAction}>
                <input type="hidden" name="groupId" value={groupData.group!.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="ব্যবহারকারী নির্বাচন করুন *" name="userId">
                    <select name="userId" className="input" required>
                      <option value="">{t("-- ব্যবহারকারী বেছে নিন --")}</option>
                      {availableUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.mobile || u.email || "ID: " + u.id})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="গ্রুপ রোল নির্বাচন করুন *" name="roleId">
                    <select name="roleId" className="input" required>
                      <option value="">{t("-- রোল বেছে নিন --")}</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} {r.description ? `(${r.description})` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="mt-3 flex gap-2">
                  <SubmitButton>{t("নিযুক্ত করুন")}</SubmitButton>
                  <button type="button" onClick={() => setShowAssignUserForm(false)} className="btn-secondary !text-xs">
                    {t("বাতিল")}
                  </button>
                </div>
              </ActionForm>
            </div>
          )}

          {/* Group Roles Catalog */}
          <div className="space-y-3">
            <h4 className="text-sm font-bold text-ink-900">{t("কনফিগার করা গ্রুপ রোলসমূহ")}</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              {roles.map((r) => (
                <div key={r.id} className="rounded-xl border border-rule bg-card p-4 shadow-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-indigo-700">{r.name}</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {r._count.memberships} {t("জন")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">{r.description || t("সেন্ট্রাল অ্যাক্সেস রোল")}</p>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {r.permissions.join(", ")}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Active Group Members */}
          <div className="space-y-3 pt-4 border-t border-rule">
            <h4 className="text-sm font-bold text-ink-900">{t("সেন্ট্রাল গ্রুপ মেম্বারবৃন্দ")}</h4>
            {members.length === 0 ? (
              <EmptyState message={t("কোনো সেন্ট্রাল গ্রুপ মেম্বার নেই")} />
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("ব্যবহারকারীর নাম")}</th>
                      <th>{t("মোবাইল / ইমেইল")}</th>
                      <th>{t("গ্রুপ রোল")}</th>
                      <th>{t("স্ট্যাটাস")}</th>
                      <th className="text-right">{t("পদক্ষেপ")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id}>
                        <td className="font-semibold text-ink-900">{m.user.name}</td>
                        <td className="text-xs text-slate-600">{m.user.mobile || m.user.email || "-"}</td>
                        <td>
                          <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-800">
                            {m.role.name}
                          </span>
                        </td>
                        <td>
                          <Badge tone={m.user.isActive ? "green" : "slate"}>
                            {m.user.isActive ? t("সক্রিয়") : t("নিষ্ক্রিয়")}
                          </Badge>
                        </td>
                        <td className="text-right">
                          {(currentBusiness.isOwner || currentBusiness.isSuperAdmin) && (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                if (confirm(`আপনি কি "${m.user.name}" এর গ্রুপ রোল বাতিল করতে চান?`)) {
                                  startTransition(async () => {
                                    await removeUserFromGroupAction(m.user.id, groupData.group!.id);
                                  });
                                }
                              }}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-800"
                            >
                              {t("বাতিল করুন")}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 4: PARTNERS ── */}
      {activeTab === "PARTNERS" && (
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-bold text-ink-900">{t("ইন্টার-কোম্পানি পার্টনার ম্যাপিং")}</h3>
            <p className="text-xs text-slate-500">
              {t("সিস্টার কনসার্ন হিসেবে চিহ্নিত কাস্টমার ও সাপ্লায়ার তালিকা — যাদের কেনাবেচায় স্বয়ংক্রিয় মিরর চালান তৈরি হয়")}
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Customers */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-ink-900 flex items-center justify-between">
                <span>{t("সিস্টার কনসার্ন কাস্টমার")}</span>
                <span className="text-xs font-normal text-slate-500">{partners.customers.length} টি</span>
              </h4>
              {partners.customers.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-rule text-center text-xs text-slate-500">
                  {t("কোনো সিস্টার কনসার্ন কাস্টমার লিংক করা নেই। কাস্টমার তৈরি বা সম্পাদনা ফর্মে 'সিস্টার কনসার্ন' নির্বাচন করুন।")}
                </div>
              ) : (
                <ul className="divide-y divide-rule border border-rule rounded-xl bg-card">
                  {partners.customers.map((c: any) => (
                    <li key={c.id} className="p-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-ink-900 block">{c.name}</span>
                        <span className="text-slate-500">
                          {t("লিংকড:")} {c.linkedBusiness?.name} ({c.linkedBusiness?.intercompanyCode || "N/A"})
                        </span>
                      </div>
                      <Link href={`/customers/${c.id}`} className="text-brand-600 hover:underline font-semibold">
                        {t("প্রোফাইল")} →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Suppliers */}
            <div className="space-y-3">
              <h4 className="text-sm font-bold text-ink-900 flex items-center justify-between">
                <span>{t("সিস্টার কনসার্ন সরবরাহকারী")}</span>
                <span className="text-xs font-normal text-slate-500">{partners.suppliers.length} টি</span>
              </h4>
              {partners.suppliers.length === 0 ? (
                <div className="p-4 rounded-xl border border-dashed border-rule text-center text-xs text-slate-500">
                  {t("কোনো সিস্টার কনসার্ন সরবরাহকারী লিংক করা নেই। সরবরাহকারী ফর্মে 'সিস্টার কনসার্ন' নির্বাচন করুন।")}
                </div>
              ) : (
                <ul className="divide-y divide-rule border border-rule rounded-xl bg-card">
                  {partners.suppliers.map((s: any) => (
                    <li key={s.id} className="p-3 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-bold text-ink-900 block">{s.name}</span>
                        <span className="text-slate-500">
                          {t("লিংকড:")} {s.linkedBusiness?.name} ({s.linkedBusiness?.intercompanyCode || "N/A"})
                        </span>
                      </div>
                      <Link href={`/suppliers/${s.id}`} className="text-brand-600 hover:underline font-semibold">
                        {t("প্রোফাইল")} →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

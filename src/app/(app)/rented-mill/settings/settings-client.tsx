"use client";

import { useState } from "react";
import {
  saveRentedMillSettingsAction,
  createAndAssignAccountantAction,
  createAndAssignPartnerAction,
  updateDryerNamesAction,
  updateExpenseCategoriesAction,
} from "@/server/actions/rented-mill";
import {
  type RentedMillSettingsData,
  parseDryerNames,
  parseExpenseCategories,
} from "@/lib/rented-mill-types";

interface UserOption {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
}

export function RentedMillSettingsClient({
  settings,
  users,
  currentAccountant,
  currentPartner,
}: {
  settings: RentedMillSettingsData;
  users: UserOption[];
  currentAccountant: UserOption | null;
  currentPartner: UserOption | null;
}) {
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [accountantMode, setAccountantMode] = useState<"assign" | "create">("assign");
  const [isSavingAccountant, setIsSavingAccountant] = useState(false);
  const [accountantMsg, setAccountantMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [partnerMode, setPartnerMode] = useState<"assign" | "create">("assign");
  const [isSavingPartner, setIsSavingPartner] = useState(false);
  const [partnerMsg, setPartnerMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [dryerList, setDryerList] = useState<string[]>(() => parseDryerNames(settings.dryerNames));
  const [isSavingDryers, setIsSavingDryers] = useState(false);
  const [dryerMsg, setDryerMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleDryersSave() {
    setIsSavingDryers(true);
    setDryerMsg(null);
    const cleaned = dryerList.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setDryerMsg({ ok: false, text: "কমপক্ষে একটি ডায়ারের নাম লিখতে হবে।" });
      setIsSavingDryers(false);
      return;
    }
    try {
      const res = await updateDryerNamesAction(cleaned);
      setDryerList(res.dryerNames);
      setDryerMsg({ ok: true, text: res.message });
    } catch (err: any) {
      setDryerMsg({ ok: false, text: err.message || "ডায়ার তালিকা সংরক্ষণ ব্যর্থ হয়েছে।" });
    } finally {
      setIsSavingDryers(false);
    }
  }

  const [expenseCatList, setExpenseCatList] = useState<string[]>(() =>
    parseExpenseCategories(settings.expenseCategories)
  );
  const [newCatInput, setNewCatInput] = useState("");
  const [isSavingExpenseCats, setIsSavingExpenseCats] = useState(false);
  const [expenseCatMsg, setExpenseCatMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleExpenseCatsSave() {
    setIsSavingExpenseCats(true);
    setExpenseCatMsg(null);
    const cleaned = expenseCatList.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setExpenseCatMsg({ ok: false, text: "কমপক্ষে একটি খরচের খতিয়ান থাকতে হবে।" });
      setIsSavingExpenseCats(false);
      return;
    }
    try {
      const res = await updateExpenseCategoriesAction(cleaned);
      setExpenseCatList(res.categories);
      setExpenseCatMsg({ ok: true, text: res.message });
    } catch (err: any) {
      setExpenseCatMsg({
        ok: false,
        text: err.message || "খরচের খতিয়ান তালিকা সংরক্ষণ ব্যর্থ হয়েছে।",
      });
    } finally {
      setIsSavingExpenseCats(false);
    }
  }

  function handleAddExpenseCat() {
    const trimmed = newCatInput.trim();
    if (!trimmed) return;
    if (expenseCatList.includes(trimmed)) {
      setExpenseCatMsg({ ok: false, text: `"${trimmed}" খতিয়ানটি পূর্বেই তালিকায় রয়েছে।` });
      return;
    }
    setExpenseCatList([...expenseCatList, trimmed]);
    setNewCatInput("");
  }

  async function handleSettingsSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsMsg(null);

    const fd = new FormData(e.currentTarget);
    try {
      const res = await saveRentedMillSettingsAction(fd);
      setSettingsMsg({ ok: true, text: res.message });
    } catch (err: any) {
      setSettingsMsg({ ok: false, text: err.message || "সেটিংস সংরক্ষণ ব্যর্থ হয়েছে।" });
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleAccountantSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSavingAccountant(true);
    setAccountantMsg(null);

    const fd = new FormData(e.currentTarget);
    fd.append("mode", accountantMode);
    try {
      const res = await createAndAssignAccountantAction(fd);
      setAccountantMsg({ ok: true, text: res.message });
    } catch (err: any) {
      setAccountantMsg({ ok: false, text: err.message || "হিসাবরক্ষক সেটআপ ব্যর্থ হয়েছে।" });
    } finally {
      setIsSavingAccountant(false);
    }
  }

  async function handlePartnerSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSavingPartner(true);
    setPartnerMsg(null);

    const fd = new FormData(e.currentTarget);
    fd.append("mode", partnerMode);
    try {
      const res = await createAndAssignPartnerAction(fd);
      setPartnerMsg({ ok: true, text: res.message });
    } catch (err: any) {
      setPartnerMsg({ ok: false, text: err.message || "পার্টনার সেটআপ ব্যর্থ হয়েছে।" });
    } finally {
      setIsSavingPartner(false);
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {/* ১. মিল কনফিগারেশন ও ৫০:৫০ শেয়ার সেটিংস */}
      <div className="rounded-xl border border-rule bg-white p-5 sm:p-6 shadow-2xs">
        <div className="border-b border-rule pb-3 mb-4">
          <h2 className="text-base sm:text-lg font-bold text-ink-900">
            মিলের তথ্য ও ৫০% : ৫০% অংশীদারিত্ব কনফিগারেশন
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            মিলের নাম, মাসিক ভাড়া এবং লাভ-ক্ষতি বণ্টনের অনুপাত নির্ধারণ করুন
          </p>
        </div>

        {settingsMsg && (
          <div
            className={`mb-4 rounded-lg p-3 text-xs font-semibold ${
              settingsMsg.ok
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {settingsMsg.text}
          </div>
        )}

        <form onSubmit={handleSettingsSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                মিলের নাম <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="millName"
                required
                defaultValue={settings.millName}
                className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                মাসিক মিল ভাড়া (টাকা) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="monthlyRent"
                step="any"
                required
                defaultValue={settings.monthlyRent}
                className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-bold text-ink-900"
              />
              <span className="text-[11px] text-slate-500">
                ডিফল্ট: ২,৮০,০০০ টাকা (খরচের হিসাবে অটো ব্যবহৃত হবে)
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                মিলের ঠিকানা
              </label>
              <input
                type="text"
                name="millAddress"
                defaultValue={settings.millAddress}
                className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                যোগাযোগের মোবাইল নম্বর
              </label>
              <input
                type="text"
                name="millPhone"
                defaultValue={settings.millPhone}
                className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs"
              />
            </div>
          </div>

          {/* ৫০:৫০ পার্টনারশিপ শেয়ার */}
          <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-brand-900 mb-3">
              অংশীদারদের নাম ও লভ্যাংশ শেয়ার অনুপাত
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Partner 1 */}
              <div className="space-y-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    অংশীদার ১ (মালিক) নাম
                  </label>
                  <input
                    type="text"
                    name="partner1Name"
                    required
                    defaultValue={settings.partner1Name}
                    className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs font-medium"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    অংশীদার ১ শেয়ার (%)
                  </label>
                  <input
                    type="number"
                    name="partner1Share"
                    step="any"
                    required
                    defaultValue={settings.partner1Share}
                    className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs font-bold text-brand-800"
                  />
                </div>
              </div>

              {/* Partner 2 */}
              <div className="space-y-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    অংশীদার ২ নাম
                  </label>
                  <input
                    type="text"
                    name="partner2Name"
                    required
                    defaultValue={settings.partner2Name}
                    className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs font-medium"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    অংশীদার ২ শেয়ার (%)
                  </label>
                  <input
                    type="number"
                    name="partner2Share"
                    step="any"
                    required
                    defaultValue={settings.partner2Share}
                    className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs font-bold text-emerald-800"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSavingSettings}
              className="btn-primary text-xs font-semibold"
            >
              {isSavingSettings ? "সংরক্ষণ হচ্ছে..." : "মিল সেটিংস সংরক্ষণ করুন"}
            </button>
          </div>
        </form>
      </div>

      {/* ২. হিসাবরক্ষক (Accountant) রোল ও অ্যাসাইনমেন্ট */}
      <div className="rounded-xl border border-rule bg-white p-5 sm:p-6 shadow-2xs">
        <div className="border-b border-rule pb-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-ink-900">
              হিসাবরক্ষক (Accountant) সেটআপ ও নিয়ন্ত্রণ
            </h2>
            <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
              স্বতন্ত্র এক্সেস
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            নির্ধারিত হিসাবরক্ষক লগইন করলে সরাসরি <b>/rented-mill</b> মডিউলে প্রবেশ করবেন। তিনি মূল ব্যবসার কোনো মেনু বা হিসাব দেখতে পাবেন না এবং কোনো এন্ট্রি ডিলিট করতে পারবেন না।
          </p>
        </div>

        {/* বর্তমান হিসাবরক্ষক স্ট্যাটাস */}
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500">বর্তমান নির্ধারিত হিসাবরক্ষক</p>
            <p className="text-sm font-bold text-ink-900 mt-0.5">
              {currentAccountant
                ? `${currentAccountant.name} (${currentAccountant.mobile || currentAccountant.email || "আইডি: " + currentAccountant.id})`
                : "কোনো হিসাবরক্ষক নির্ধারিত নেই (সুপার অ্যাডমিন নিজেই পরিচালনা করছেন)"}
            </p>
          </div>
          {currentAccountant && (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              সক্রিয়
            </span>
          )}
        </div>

        {accountantMsg && (
          <div
            className={`mb-4 rounded-lg p-3 text-xs font-semibold ${
              accountantMsg.ok
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {accountantMsg.text}
          </div>
        )}

        {/* ট্যাব: বিদ্যমান ইউজার অ্যাসাইন অথবা নতুন ইউজার তৈরি */}
        <div className="flex items-center gap-2 mb-4 border-b pb-2">
          <button
            type="button"
            onClick={() => setAccountantMode("assign")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              accountantMode === "assign"
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            বিদ্যমান ব্যবহারকারী থেকে নির্বাচন
          </button>
          <button
            type="button"
            onClick={() => setAccountantMode("create")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              accountantMode === "create"
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            + নতুন হিসাবরক্ষক তৈরি করুন
          </button>
        </div>

        <form onSubmit={handleAccountantSubmit} className="space-y-4">
          {accountantMode === "assign" ? (
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                ব্যবহারকারী নির্বাচন করুন
              </label>
              <select
                name="userId"
                defaultValue={settings.accountantUserId || ""}
                className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-medium"
              >
                <option value="">-- কাউকে নির্ধারিত না রাখা (খালি রাখুন) --</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} {u.mobile ? `(${u.mobile})` : u.email ? `(${u.email})` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-slate-200 p-4 bg-slate-50/50">
              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  হিসাবরক্ষকের নাম <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="যেমন: মোঃ রফিকুল ইসলাম"
                  className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    মোবাইল নম্বর (লগইন ইউজারনেম) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="mobile"
                    required
                    placeholder="017xxxxxxxx"
                    className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    লগইন পাসওয়ার্ড <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    name="password"
                    required
                    placeholder="নূন্যতম ৬ অক্ষর"
                    className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSavingAccountant}
              className="btn-primary text-xs font-semibold"
            >
              {isSavingAccountant
                ? "সংরক্ষণ হচ্ছে..."
                : accountantMode === "assign"
                ? "হিসাবরক্ষক অ্যাসাইন করুন"
                : "নতুন হিসাবরক্ষক তৈরি ও অ্যাসাইন করুন"}
            </button>
          </div>
        </form>
      </div>

      {/* ৩. পার্টনার (৫০%) সেটআপ ও নিয়ন্ত্রণ (শুধু দেখার অনুমতি / Read-Only) */}
      <div className="rounded-xl border border-rule bg-white p-5 sm:p-6 shadow-2xs">
        <div className="border-b border-rule pb-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-ink-900">
              পার্টনার (৫০%) সেটআপ ও নিয়ন্ত্রণ (শুধু দেখার অনুমতি / Read-Only)
            </h2>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
              Read-Only
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            নির্ধারিত পার্টনার লগইন করলে সরাসরি <b>/rented-mill</b> মডিউলে প্রবেশ করবেন। তিনি মূল ব্যবসার কোনো মেনু দেখতে পাবেন না। ভাড়া অটো মিলের সব রিপোর্ট, ৫০:৫০ লাভ-ক্ষতি ও লেজার দেখতে ও প্রিন্ট করতে পারবেন, কিন্তু কোনো এন্ট্রি করা, পরিবর্তন বা ডিলিট করার অনুমতি থাকবে না।
          </p>
        </div>

        {/* বর্তমান পার্টনার স্ট্যাটাস */}
        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500">বর্তমান নির্ধারিত পার্টনার (৫০%)</p>
            <p className="text-sm font-bold text-ink-900 mt-0.5">
              {currentPartner
                ? `${currentPartner.name} (${currentPartner.mobile || currentPartner.email || "আইডি: " + currentPartner.id})`
                : "কোনো পার্টনার নির্ধারিত নেই"}
            </p>
          </div>
          {currentPartner && (
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              সক্রিয় (Read-Only)
            </span>
          )}
        </div>

        {partnerMsg && (
          <div
            className={`mb-4 rounded-lg p-3 text-xs font-semibold ${
              partnerMsg.ok
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {partnerMsg.text}
          </div>
        )}

        {/* ট্যাব: বিদ্যমান ইউজার অ্যাসাইন অথবা নতুন পার্টনার তৈরি */}
        <div className="flex items-center gap-2 mb-4 border-b pb-2">
          <button
            type="button"
            onClick={() => setPartnerMode("assign")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              partnerMode === "assign"
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            বিদ্যমান ব্যবহারকারী থেকে নির্বাচন
          </button>
          <button
            type="button"
            onClick={() => setPartnerMode("create")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              partnerMode === "create"
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            + নতুন পার্টনার তৈরি করুন
          </button>
        </div>

        <form onSubmit={handlePartnerSubmit} className="space-y-4">
          {partnerMode === "assign" ? (
            <div>
              <label className="block text-xs font-semibold text-ink-800 mb-1">
                ব্যবহারকারী নির্বাচন করুন
              </label>
              <select
                name="userId"
                defaultValue={settings.partnerUserId || ""}
                className="w-full rounded-md border border-rule bg-white px-3 py-2 text-xs font-medium"
              >
                <option value="">-- কাউকে নির্ধারিত না রাখা (খালি রাখুন) --</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} {u.mobile ? `(${u.mobile})` : u.email ? `(${u.email})` : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-slate-200 p-4 bg-slate-50/50">
              <div>
                <label className="block text-xs font-semibold text-ink-800 mb-1">
                  পার্টনারের নাম <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="যেমন: পার্টনারের পূর্ণ নাম"
                  className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    মোবাইল নম্বর (লগইন ইউজারনেম) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="mobile"
                    required
                    placeholder="017xxxxxxxx"
                    className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-800 mb-1">
                    লগইন পাসওয়ার্ড <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="password"
                    name="password"
                    required
                    placeholder="নূন্যতম ৬ অক্ষর"
                    className="w-full rounded-md border border-rule bg-white px-3 py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSavingPartner}
              className="btn-primary text-xs font-semibold"
            >
              {isSavingPartner
                ? "সংরক্ষণ হচ্ছে..."
                : partnerMode === "assign"
                ? "পার্টনার অ্যাসাইন করুন"
                : "পার্টনার আইডি তৈরি ও নির্ধারণ করুন"}
            </button>
          </div>
        </form>
      </div>

      {/* ৪. ডায়ার তালিকা ও নাম পরিবর্তন (Dryer Management) */}
      <div className="rounded-xl border border-rule bg-white p-5 sm:p-6 shadow-2xs">
        <div className="border-b border-rule pb-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-ink-900">
              ♨️ ডায়ার তালিকা ও নাম পরিবর্তন (Dryer Management)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            মিলের প্রতিটি ডায়ারের নাম পরিবর্তন করুন বা প্রয়োজনে নতুন ডায়ার যুক্ত/বাতিল করুন
          </p>
        </div>

        {dryerMsg && (
          <div
            className={`mb-4 rounded-lg p-3 text-xs font-semibold ${
              dryerMsg.ok
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {dryerMsg.text}
          </div>
        )}

        <div className="space-y-3">
          {dryerList.map((name, idx) => (
            <div key={idx} className="flex items-center gap-2 max-w-md">
              <span className="w-6 text-center text-xs font-bold text-slate-400">
                {idx + 1}.
              </span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  const updated = [...dryerList];
                  updated[idx] = e.target.value;
                  setDryerList(updated);
                }}
                placeholder={`যেমন: ডায়ার-${idx + 1} বা বড় ডায়ার`}
                className="flex-1 rounded-md border border-rule bg-white px-3 py-2 text-xs font-medium text-ink-900 focus:border-brand-500"
              />
              {dryerList.length > 1 && (
                <button
                  type="button"
                  onClick={() => setDryerList(dryerList.filter((_, i) => i !== idx))}
                  title="মুছুন"
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => setDryerList([...dryerList, `ডায়ার-${dryerList.length + 1}`])}
            className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline pt-1"
          >
            <span>➕</span> নতুন ডায়ার যোগ করুন
          </button>

          <div className="rounded-lg bg-amber-50/80 border border-amber-200 p-2.5 text-[11px] text-amber-900 mt-2 max-w-md">
            💡 <b>মনে রাখুন:</b> &ldquo;সরাসরি মিলিং (ডায়ার ছাড়া)&rdquo; অপশনটি সব ড্রপডাউনে স্বয়ংক্রিয়ভাবে স্থায়ী থাকবে।
          </div>

          <div className="pt-3">
            <button
              type="button"
              disabled={isSavingDryers}
              onClick={handleDryersSave}
              className="btn-primary text-xs font-semibold"
            >
              {isSavingDryers ? "সংরক্ষণ হচ্ছে..." : "ডায়ার তালিকা সংরক্ষণ করুন"}
            </button>
          </div>
        </div>
      </div>

      {/* ৫. খরচের খতিয়ান / খাত ব্যবস্থাপনা (Expense Categories) */}
      <div className="rounded-xl border border-rule bg-white p-5 sm:p-6 shadow-2xs">
        <div className="border-b border-rule pb-3 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-ink-900">
              📋 খরচের খতিয়ান / খাত ব্যবস্থাপনা (Expense Categories)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            মিলের প্রয়োজন অনুযায়ী খরচের খাত/খতিয়ান তৈরি, নাম সম্পাদনা বা অপ্রয়োজনীয় খাত বাদ দিন। এগুলো খরচ এন্ট্রি ফর্ম ও রিপোর্টে সরাসরি যুক্ত হবে।
          </p>
        </div>

        {expenseCatMsg && (
          <div
            className={`mb-4 rounded-lg p-3 text-xs font-semibold ${
              expenseCatMsg.ok
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {expenseCatMsg.text}
          </div>
        )}

        <div className="space-y-3">
          {expenseCatList.map((name, idx) => (
            <div key={idx} className="flex items-center gap-2 max-w-md">
              <span className="w-6 text-center text-xs font-bold text-slate-400">
                {idx + 1}.
              </span>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  const updated = [...expenseCatList];
                  updated[idx] = e.target.value;
                  setExpenseCatList(updated);
                }}
                placeholder="খাতের নাম লিখুন"
                className="flex-1 rounded-md border border-rule bg-white px-3 py-2 text-xs font-semibold text-ink-900 focus:border-brand-500"
              />
              {expenseCatList.length > 1 && (
                <button
                  type="button"
                  onClick={() => setExpenseCatList(expenseCatList.filter((_, i) => i !== idx))}
                  title="মুছুন"
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          {/* নতুন খাত যোগ করার ইনপুট */}
          <div className="pt-2 max-w-md">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              + নতুন খরচের খতিয়ান যোগ করুন:
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newCatInput}
                onChange={(e) => setNewCatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddExpenseCat();
                  }
                }}
                placeholder="যেমন: জেনারেটর তেল/ডিজেল, গাড়ি ভাড়া, আপ্যায়ন খরচ"
                className="flex-1 rounded-md border border-dashed border-slate-300 bg-slate-50/70 px-3 py-2 text-xs font-medium text-ink-900 focus:border-brand-500 focus:bg-white"
              />
              <button
                type="button"
                onClick={handleAddExpenseCat}
                disabled={!newCatInput.trim()}
                className="btn-outline text-xs px-3 py-2 font-semibold disabled:opacity-50"
              >
                + তালিকায় যোগ
              </button>
            </div>
          </div>

          <div className="rounded-lg bg-blue-50/80 border border-blue-200 p-2.5 text-[11px] text-blue-900 mt-2 max-w-md">
            💡 <b>পরামর্শ:</b> তালিকা সম্পাদনা বা নতুন খাত যোগ করার পর নিচের <b>&ldquo;খতিয়ান সংরক্ষণ করুন&rdquo;</b> বাটনে ক্লিক করতে ভুলবেন না।
          </div>

          <div className="pt-3">
            <button
              type="button"
              disabled={isSavingExpenseCats}
              onClick={handleExpenseCatsSave}
              className="btn-primary text-xs font-semibold"
            >
              {isSavingExpenseCats ? "সংরক্ষণ হচ্ছে..." : "খতিয়ান সংরক্ষণ করুন"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { createAndAssignMillUserAction } from "@/server/actions/custom-milling";
import type { ActionState } from "@/server/action-utils";

export interface MillUserOption {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  isSuperAdmin: boolean;
}

interface UserAssignmentProps {
  users: MillUserOption[];
  initialAccountantId: string | null;
  initialPartnerId: string | null;
  isReadOnly: boolean;
}

export function MillUserAssignmentSection({
  users,
  initialAccountantId,
  initialPartnerId,
  isReadOnly,
}: UserAssignmentProps) {
  const [userList, setUserList] = useState<MillUserOption[]>(users);
  const [accountantId, setAccountantId] = useState<string>(initialAccountantId || "");
  const [partnerId, setPartnerId] = useState<string>(initialPartnerId || "");

  // Modal State for Creating New User
  const [modalRole, setModalRole] = useState<"ACCOUNTANT" | "PARTNER" | null>(null);
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const handleCreateUser = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    const fd = new FormData(e.currentTarget);
    const targetRole = modalRole || "ACCOUNTANT";
    fd.set("targetRole", targetRole);

    startTransition(async () => {
      try {
        const res = await createAndAssignMillUserAction({ ok: true }, fd);
        if (res && res.ok) {
          setFormSuccess(res.message || "ব্যবহারকারী সফলভাবে তৈরি ও অ্যাসাইন হয়েছে");
          const data = (res as any).data;
          if (data?.userId) {
            const newUser: MillUserOption = {
              id: data.userId,
              name: data.name || "নতুন ব্যবহারকারী",
              email: data.identifier?.includes("@") ? data.identifier : null,
              mobile: !data.identifier?.includes("@") ? data.identifier : null,
              isSuperAdmin: false,
            };
            setUserList((prev) => [newUser, ...prev]);
            if (targetRole === "PARTNER") {
              setPartnerId(data.userId);
            } else {
              setAccountantId(data.userId);
            }
          }
          setTimeout(() => {
            setModalRole(null);
            setFormSuccess(null);
          }, 1000);
        } else {
          setFormError(res?.message || "ব্যবহারকারী তৈরিতে সমস্যা হয়েছে");
        }
      } catch (err: any) {
        setFormError(err.message || "সার্ভার এরর");
      }
    });
  };

  return (
    <section className="panel p-5 sm:p-6 space-y-6">
      <div className="border-b border-rule pb-3">
        <h2 className="panel-title flex items-center gap-2 text-base sm:text-lg">
          <span>👥</span>
          <span>ব্যবহারকারী ও রোল অ্যাসাইনমেন্ট (হিসাবরক্ষক ও পার্টনার)</span>
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          ভাড়া অটো মিলের জন্য হিসাবরক্ষক এবং পার্টনার (৪০%) অ্যাসাইন করুন। তারা লগইন করলে সরাসরি ভাড়া মিল ব্যবস্থাপনায় প্রবেশ করবে।
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Option A: Accountant Setup */}
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="accountantUserId" className="text-sm font-bold text-amber-950 flex items-center gap-1.5">
                <span>🌾</span>
                <span>হিসাবরক্ষক (Accountant - এন্ট্রি ও পরিচালনা)</span>
              </label>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setFormSuccess(null);
                    setModalRole("ACCOUNTANT");
                  }}
                  className="rounded-lg border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-900 shadow-2xs hover:bg-amber-200 transition"
                >
                  + নতুন হিসাবরক্ষক তৈরি করুন
                </button>
              )}
            </div>

            <div>
              <select
                id="accountantUserId"
                name="accountantUserId"
                value={accountantId}
                onChange={(e) => setAccountantId(e.target.value)}
                disabled={isReadOnly}
                className="input font-medium bg-white"
              >
                <option value="">(কেউ নির্ধারিত নেই / Not Assigned)</option>
                {userList.map((u) => {
                  const contact = u.mobile || u.email || "মোবাইল/ইমেইল নেই";
                  return (
                    <option key={u.id} value={u.id}>
                      {u.name} — {contact} {u.isSuperAdmin ? "[Super Admin]" : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="rounded-lg border border-amber-200/80 bg-white/80 p-3 text-xs text-amber-900 space-y-1">
              <p className="font-semibold flex items-center gap-1 text-[11px] uppercase tracking-wide text-amber-800">
                <span>🛡️</span>
                <span>হিসাবরক্ষকের নির্ধারিত অধিকার ও সীমাবদ্ধতা:</span>
              </p>
              <ul className="list-disc pl-4 space-y-0.5 text-slate-700 text-[11px]">
                <li>লগইন করলে স্বয়ংক্রিয়ভাবে <b>/custom-milling</b> ড্যাশবোর্ডে যাবে।</li>
                <li>মূল ব্যবসা (আল্লাহর দান এন্টারপ্রাইজ)-এর অন্য কোনো মেনু তাকে দেখাবে না।</li>
                <li>ধান গ্রহণ ও ওজন স্কেল, মিলিং খরচ, ক্যাশ বুক ও ভাউচার এন্ট্রি দিতে পারবেন।</li>
                <li>কোনো এন্ট্রি ডিলিট বা মূল অ্যাকাউন্টে ব্রিজ সিঙ্ক করার ক্ষমতা থাকবে না।</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Option B: Partner Setup (40%) */}
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="partnerUserId" className="text-sm font-bold text-blue-950 flex items-center gap-1.5">
                <span>🤝</span>
                <span>পার্টনার (৪০% শেয়ারহোল্ডার - Read-Only)</span>
              </label>
              {!isReadOnly && (
                <button
                  type="button"
                  onClick={() => {
                    setFormError(null);
                    setFormSuccess(null);
                    setModalRole("PARTNER");
                  }}
                  className="rounded-lg border border-blue-300 bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-900 shadow-2xs hover:bg-blue-200 transition"
                >
                  + নতুন পার্টনার তৈরি করুন
                </button>
              )}
            </div>

            <div>
              <select
                id="partnerUserId"
                name="partnerUserId"
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                disabled={isReadOnly}
                className="input font-medium bg-white"
              >
                <option value="">(কেউ নির্ধারিত নেই / Not Assigned)</option>
                {userList.map((u) => {
                  const contact = u.mobile || u.email || "মোবাইল/ইমেইল নেই";
                  return (
                    <option key={u.id} value={u.id}>
                      {u.name} — {contact} {u.isSuperAdmin ? "[Super Admin]" : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="rounded-lg border border-blue-200/80 bg-white/80 p-3 text-xs text-blue-900 space-y-1">
              <p className="font-semibold flex items-center gap-1 text-[11px] uppercase tracking-wide text-blue-800">
                <span>👁️</span>
                <span>পার্টনারের নির্ধারিত অধিকার (শুধু দেখার অনুমতি):</span>
              </p>
              <ul className="list-disc pl-4 space-y-0.5 text-slate-700 text-[11px]">
                <li>লগইন করলে স্বয়ংক্রিয়ভাবে <b>/custom-milling</b> ড্যাশবোর্ডে যাবে।</li>
                <li>মূল ব্যবসা (আল্লাহর দান এন্টারপ্রাইজ)-এর অন্য কোনো মেনু তাকে দেখাবে না।</li>
                <li>ভাড়া মিলের ব্যাচ, বিল, খরচ ও <b>৬০:৪০ পার্টনারশিপ হিসাব</b> দেখতে পারবেন।</li>
                <li>কোনো এন্ট্রি তৈরি, পরিবর্তন বা মুছে ফেলতে পারবেন না (সম্পূর্ণ Read-Only)।</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Modal Dialog for Creating New User */}
      {modalRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-rule bg-white p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-rule pb-3">
              <h3 className="text-base font-bold text-ink-900 flex items-center gap-2">
                <span>{modalRole === "ACCOUNTANT" ? "🌾" : "🤝"}</span>
                <span>
                  {modalRole === "ACCOUNTANT"
                    ? "নতুন হিসাবরক্ষক তৈরি করুন"
                    : "নতুন পার্টনার অ্যাকাউন্ট তৈরি করুন"}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setModalRole(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-800">
                ⚠ {formError}
              </div>
            )}

            {formSuccess && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
                ✓ {formSuccess}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="label text-xs font-bold text-slate-800" htmlFor="mill-user-name">
                  পুরো নাম (Full Name) *
                </label>
                <input
                  id="mill-user-name"
                  name="name"
                  placeholder={modalRole === "ACCOUNTANT" ? "উদাঃ মোঃ মামুন হোসেন (হিসাবরক্ষক)" : "উদাঃ আলহাজ্ব রফিকুল ইসলাম (পার্টনার)"}
                  className="input text-sm"
                  required
                />
              </div>

              <div>
                <label className="label text-xs font-bold text-slate-800" htmlFor="mill-user-identifier">
                  মোবাইল নম্বর অথবা ইমেইল *
                </label>
                <input
                  id="mill-user-identifier"
                  name="identifier"
                  placeholder="উদাঃ 017XXXXXXXX অথবা user@gmail.com"
                  className="input text-sm"
                  required
                />
                <span className="text-[11px] text-slate-500">
                  লগইন করার জন্য ব্যবহারকারী এই মোবাইল নম্বর বা ইমেইল ব্যবহার করবেন।
                </span>
              </div>

              <div>
                <label className="label text-xs font-bold text-slate-800" htmlFor="mill-user-password">
                  লগইন পাসওয়ার্ড *
                </label>
                <input
                  id="mill-user-password"
                  name="password"
                  type="password"
                  minLength={6}
                  placeholder="কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড"
                  className="input text-sm"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-rule">
                <button
                  type="button"
                  onClick={() => setModalRole(null)}
                  disabled={isPending}
                  className="btn-outline text-xs px-3 py-2"
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn-primary text-xs px-4 py-2 font-bold"
                >
                  {isPending ? "তৈরি হচ্ছে…" : "✓ তৈরি ও অ্যাসাইন করুন"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

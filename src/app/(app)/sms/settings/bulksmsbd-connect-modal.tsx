"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toaster";
import { Field } from "@/components/forms";
import { autoConnectBulkSmsBdAction } from "@/server/actions/sms";

export interface BulkSmsBdRegistrationData {
  registrationUrl: string;
  rechargeUrl: string;
  prefilled: {
    name: string;
    mobile: string;
    email: string;
  };
}

export function BulkSmsBdQuickActions({
  registrationData,
  onConnected,
}: {
  registrationData: BulkSmsBdRegistrationData;
  onConnected?: (data: { balance?: number; apiKeyHint?: string; senderId?: string }) => void;
}) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50/70 p-3 sm:col-span-2">
        <div className="flex items-center gap-2 text-xs font-medium text-sky-900">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-[11px] font-bold text-white">
            ⚡
          </span>
          <span>BulkSMSBD অটোমেশন:</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConnectOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-sky-700 focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:ring-offset-1"
          >
            <span>⚡</span>
            <span>BulkSMSBD থেকে স্বয়ংক্রিয় কানেক্ট করুন</span>
          </button>
          <button
            type="button"
            onClick={() => setRegisterOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 shadow-xs hover:bg-sky-50 focus:outline-hidden focus:ring-2 focus:ring-sky-500 focus:ring-offset-1"
          >
            <span>📝</span>
            <span>নতুন অ্যাকাউন্ট তৈরি করুন (BulkSMSBD)</span>
          </button>
        </div>
      </div>

      {connectOpen && (
        <BulkSmsBdConnectDialog
          onClose={() => setConnectOpen(false)}
          onConnected={onConnected}
        />
      )}

      {registerOpen && (
        <BulkSmsBdRegisterDialog
          data={registrationData}
          onClose={() => setRegisterOpen(false)}
        />
      )}
    </>
  );
}

export function BulkSmsBdConnectDialog({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected?: (data: { balance?: number; apiKeyHint?: string; senderId?: string }) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"login" | "apiKey" | "popup">("login");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Login form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Direct API key state
  const [apiKey, setApiKey] = useState("");
  const [senderId, setSenderId] = useState("");

  // Listen for popup callback message
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data && event.data.type === "BULKSMSBD_CONNECTED") {
        toast("BulkSMSBD সফলভাবে কানেক্ট হয়েছে!", "success");
        if (onConnected) {
          onConnected({
            balance: event.data.balance,
            apiKeyHint: event.data.apiKeyHint,
            senderId: event.data.senderId,
          });
        }
        onClose();
        router.refresh();
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onClose, onConnected, router, toast]);

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("ইউজারনেম ও পাসওয়ার্ড উভয়ই প্রদান করুন");
      return;
    }

    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("mode", "login");
      fd.append("username", username.trim());
      fd.append("password", password.trim());

      const res = await autoConnectBulkSmsBdAction(null, fd);
      if (res?.ok) {
        toast(res.message || "BulkSMSBD সফলভাবে কানেক্ট হয়েছে!", "success");
        if (onConnected && res.data) {
          onConnected({
            balance: res.data.balance ? Number(res.data.balance) : undefined,
            apiKeyHint: res.data.apiKeyHint,
            senderId: res.data.senderId,
          });
        }
        onClose();
        router.refresh();
      } else {
        setError(res?.message || "BulkSMSBD লগইন বা কানেকশন ব্যর্থ হয়েছে");
      }
    });
  };

  const handleApiKeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError("BulkSMSBD API কী প্রদান করুন");
      return;
    }

    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("mode", "apiKey");
      fd.append("apiKey", apiKey.trim());
      if (senderId.trim()) fd.append("senderId", senderId.trim());

      const res = await autoConnectBulkSmsBdAction(null, fd);
      if (res?.ok) {
        toast(res.message || "BulkSMSBD সফলভাবে কানেক্ট হয়েছে!", "success");
        if (onConnected && res.data) {
          onConnected({
            balance: res.data.balance ? Number(res.data.balance) : undefined,
            apiKeyHint: res.data.apiKeyHint,
            senderId: res.data.senderId,
          });
        }
        onClose();
        router.refresh();
      } else {
        setError(res?.message || "API কী যাচাইকরণ ব্যর্থ হয়েছে");
      }
    });
  };

  const handleOpenPopup = () => {
    const width = 640;
    const height = 720;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;
    window.open(
      "https://bulksmsbd.net/login",
      "BulkSMSBDAuth",
      `width=${width},height=${height},top=${top},left=${left},status=yes,scrollbars=yes,resizable=yes`
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10">
        <div className="border-b border-rule bg-slate-50/80 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white">
                ⚡
              </span>
              <div>
                <h3 className="text-base font-bold text-ink-900">BulkSMSBD স্বয়ংক্রিয় কানেকশন</h3>
                <p className="text-xs text-slate-500">এক ক্লিকেই API Key সংরক্ষণ ও রিয়েলটাইম ব্যালেন্স সিঙ্ক</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              aria-label="বন্ধ করুন"
            >
              ✕
            </button>
          </div>

          <div className="mt-4 flex gap-1 rounded-lg bg-slate-200/70 p-1 text-xs font-semibold text-slate-700">
            <button
              type="button"
              onClick={() => {
                setTab("login");
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 transition-colors ${
                tab === "login" ? "bg-white text-sky-700 shadow-xs" : "hover:text-ink-900"
              }`}
            >
              ইউজার লগইন (ব্রিজ)
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("apiKey");
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 transition-colors ${
                tab === "apiKey" ? "bg-white text-sky-700 shadow-xs" : "hover:text-ink-900"
              }`}
            >
              সরাসরি API Key
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("popup");
                setError(null);
              }}
              className={`flex-1 rounded-md py-1.5 transition-colors ${
                tab === "popup" ? "bg-white text-sky-700 shadow-xs" : "hover:text-ink-900"
              }`}
            >
              পপআপ পোর্টাল
            </button>
          </div>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-xs font-medium text-red-700 ring-1 ring-red-200">
              {error}
            </div>
          )}

          {tab === "login" && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <p className="text-xs text-slate-600">
                BulkSMSBD অ্যাকাউন্টের ইউজারনেম/মোবাইল ও পাসওয়ার্ড দিন। ব্যাকএন্ড স্বয়ংক্রিয়ভাবে আপনার অনুমোদিত
                API Key ও Sender ID সংগ্রহ করে ব্যালেন্স যুক্ত করবে।
              </p>
              <div>
                <label className="block text-xs font-semibold text-ink-800">
                  BulkSMSBD ইউজারনেম বা মোবাইল নম্বর <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="যেমন: 01712345678 বা username"
                  className="input mt-1 w-full"
                  disabled={isPending}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-800">
                  পাসওয়ার্ড <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="BulkSMSBD অ্যাকাউন্টের পাসওয়ার্ড"
                  className="input mt-1 w-full"
                  disabled={isPending}
                />
              </div>

              <div className="rounded-md bg-amber-50 p-2.5 text-[11px] text-amber-800 ring-1 ring-amber-200">
                🔒 নিরাপত্তা তথ্য: আপনার পাসওয়ার্ড ডাটাবেজে সংরক্ষণ করা হয় না; শুধুমাত্র তাৎক্ষণিকভাবে API কী ফেচ করার কাজে ব্যবহৃত হয়।
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-outline btn-sm"
                  disabled={isPending}
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn-primary btn-sm flex items-center gap-1.5"
                >
                  {isPending ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>কানেক্ট হচ্ছে…</span>
                    </>
                  ) : (
                    <>
                      <span>⚡</span>
                      <span>অ্যাকাউন্ট কানেক্ট করুন</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {tab === "apiKey" && (
            <form onSubmit={handleApiKeySubmit} className="space-y-4">
              <p className="text-xs text-slate-600">
                আপনার BulkSMSBD ড্যাশবোর্ডের API কী ও অনুমোদিত সেন্ডার আইডি থাকলে নিচে প্রদান করুন। সাথে সাথে
                ব্যালেন্স যাচাই করে SMS সক্রিয় হবে।
              </p>
              <div>
                <label className="block text-xs font-semibold text-ink-800">
                  BulkSMSBD API কী <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="BulkSMSBD ড্যাশবোর্ড থেকে কপি করা API Key"
                  className="input mt-1 w-full"
                  disabled={isPending}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-800">
                  অনুমোদিত সেন্ডার আইডি / মাস্কিং (ঐচ্ছিক)
                </label>
                <input
                  type="text"
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  placeholder="যেমন: 88096... অথবা নন-মাস্কিং খালি রাখুন"
                  maxLength={20}
                  className="input mt-1 w-full"
                  disabled={isPending}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-outline btn-sm"
                  disabled={isPending}
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn-primary btn-sm flex items-center gap-1.5"
                >
                  {isPending ? (
                    <>
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>যাচাই হচ্ছে…</span>
                    </>
                  ) : (
                    <>
                      <span>🔍</span>
                      <span>যাচাই ও কানেক্ট করুন</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {tab === "popup" && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                BulkSMSBD পোর্টাল পপআপ উইন্ডোতে খুলে লগইন করুন। পোর্টাল অ্যাক্সেস সম্পন্ন হলে এক ক্লিকেই API কী
                যুক্ত হয়ে যাবে।
              </p>

              <div className="rounded-lg border border-dashed border-sky-300 bg-sky-50/50 p-4 text-center">
                <p className="mb-3 text-xs text-slate-600">
                  নিচের বাটনে চাপলে BulkSMSBD লগইন পোর্টাল নতুন উইন্ডোতে প্রদর্শিত হবে:
                </p>
                <button
                  type="button"
                  onClick={handleOpenPopup}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-sky-700"
                >
                  <span>🌐</span>
                  <span>BulkSMSBD পোর্টাল পপআপ খুলুন</span>
                </button>
              </div>

              <div className="border-t border-rule pt-3">
                <label className="block text-xs font-semibold text-ink-800">
                  অথবা পোর্টাল থেকে প্রাপ্ত API কী এখানে পেস্ট করুন:
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="API Key পেস্ট করুন"
                    className="input flex-1"
                    disabled={isPending}
                  />
                  <button
                    type="button"
                    onClick={handleApiKeySubmit}
                    disabled={isPending || !apiKey.trim()}
                    className="btn-secondary btn-sm"
                  >
                    কানেক্ট
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button type="button" onClick={onClose} className="btn-outline btn-sm">
                  বন্ধ করুন
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BulkSmsBdRegisterDialog({
  data,
  onClose,
}: {
  data: BulkSmsBdRegistrationData;
  onClose: () => void;
}) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (text: string, field: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10">
        <div className="border-b border-rule bg-slate-50/80 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
                📝
              </span>
              <div>
                <h3 className="text-base font-bold text-ink-900">BulkSMSBD নতুন অ্যাকাউন্ট রেজিস্ট্রেশন</h3>
                <p className="text-xs text-slate-500">সহজে একাউন্ট তৈরি করতে আপনার ব্যবসার তথ্য কপি করে নিন</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              aria-label="বন্ধ করুন"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-xs text-slate-600">
            BulkSMSBD পোর্টালে রেজিস্ট্রেশনের জন্য নিচের তথ্যগুলো ব্যবহার করুন। প্রতিটি ফিল্ডের পাশের
            &quot;কপি করুন&quot; বাটনে ক্লিক করে রেজিস্ট্রেশন ফর্মে পেস্ট করুন:
          </p>

          <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <span className="font-semibold text-slate-500">প্রতিষ্ঠানের নাম: </span>
                <span className="font-medium text-ink-900">{data.prefilled.name || "—"}</span>
              </div>
              {data.prefilled.name && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(data.prefilled.name, "name")}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {copiedField === "name" ? "✓ কপি হয়েছে!" : "কপি করুন"}
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <span className="font-semibold text-slate-500">মোবাইল নম্বর: </span>
                <span className="font-medium text-ink-900">{data.prefilled.mobile || "—"}</span>
              </div>
              {data.prefilled.mobile && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(data.prefilled.mobile, "mobile")}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {copiedField === "mobile" ? "✓ কপি হয়েছে!" : "কপি করুন"}
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <span className="font-semibold text-slate-500">ইমেইল ঠিকানা: </span>
                <span className="font-medium text-ink-900">{data.prefilled.email || "—"}</span>
              </div>
              {data.prefilled.email && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(data.prefilled.email, "email")}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {copiedField === "email" ? "✓ কপি হয়েছে!" : "কপি করুন"}
                </button>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-sky-50 p-3 text-xs text-sky-900 ring-1 ring-sky-200">
            <h4 className="font-semibold text-sky-950">ধাপসমূহ:</h4>
            <ol className="mt-1 list-decimal space-y-1 pl-4 text-[11px]">
              <li>নিচের বাটনে ক্লিক করে BulkSMSBD অফিশিয়াল রেজিস্ট্রেশন পেজ খুলুন।</li>
              <li>উপরের কপি করা তথ্য দিয়ে ফর্ম পূরণ করে ওটিপি ভেরিফিকেশন সম্পন্ন করুন।</li>
              <li>অ্যাকাউন্ট তৈরি হলে বিজয়ে ফিরে এসে &quot;BulkSMSBD থেকে স্বয়ংক্রিয় কানেক্ট করুন&quot; চাপুন।</li>
            </ol>
          </div>

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" onClick={onClose} className="btn-outline btn-sm">
              বন্ধ করুন
            </button>
            <a
              href={data.registrationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary btn-sm inline-flex items-center justify-center gap-1.5"
            >
              <span>🌐</span>
              <span>BulkSMSBD রেজিস্ট্রেশন পেজে যান ↗</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProviderFormFields({
  initialProvider,
  apiKeyHint,
  initialSenderId,
  providers,
  providerLabels,
  platform,
  registrationData,
}: {
  initialProvider: string;
  apiKeyHint?: string | null;
  initialSenderId?: string | null;
  providers: string[];
  providerLabels: Record<string, string>;
  platform: boolean;
  registrationData: BulkSmsBdRegistrationData;
}) {
  const [provider, setProvider] = useState(initialProvider);
  const [currentHint, setCurrentHint] = useState(apiKeyHint);
  const [currentSenderId, setCurrentSenderId] = useState(initialSenderId ?? "");

  return (
    <>
      <Field label="প্রোভাইডার" name="provider">
        <select
          id="provider"
          name="provider"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="input"
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {providerLabels[p] ?? p}
            </option>
          ))}
        </select>
      </Field>

      {provider === "bulksmsbd" && (
        <BulkSmsBdQuickActions
          registrationData={registrationData}
          onConnected={(data) => {
            if (data.apiKeyHint) setCurrentHint(data.apiKeyHint);
            if (data.senderId) setCurrentSenderId(data.senderId);
          }}
        />
      )}

      <Field
        label="API কী"
        name="apiKey"
        hint={
          currentHint
            ? `সংরক্ষিত কী: ${currentHint} — পরিবর্তন না করলে খালি রাখুন`
            : "এনক্রিপ্ট করে সংরক্ষণ হয়; কখনো আর দেখানো হয় না"
        }
      >
        <input
          id="apiKey"
          name="apiKey"
          type="password"
          autoComplete="new-password"
          className="input"
          placeholder={currentHint ?? ""}
        />
      </Field>

      <Field label="সেন্ডার আইডি / মাস্কিং" name="senderId" hint="প্রোভাইডারে অনুমোদিত নাম বা নম্বর">
        <input
          id="senderId"
          name="senderId"
          value={currentSenderId}
          onChange={(e) => setCurrentSenderId(e.target.value)}
          maxLength={20}
          className="input"
        />
      </Field>
    </>
  );
}


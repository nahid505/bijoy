import type { Metadata } from "next";
import { prisma, num } from "@/lib/db";
import { formatDateTime, formatNumber } from "@/lib/format";
import { SMS_EVENTS } from "@/lib/sms-text";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { refreshSmsBalanceAction, saveSmsSettingsAction, sendTestSmsAction } from "@/server/actions/sms";
import { availableProviders, platformConfig, PROVIDER_LABELS } from "@/server/sms/providers";
import { SmsTabs } from "../sms-ui";

export const metadata: Metadata = { title: "এসএমএস সেটিং" };

const GROUPS = [
  { key: "customer", label: "কাস্টমার" },
  { key: "supplier", label: "সরবরাহকারী" },
  { key: "inventory", label: "মজুদ ও মেয়াদ (মালিকের মোবাইলে)" },
] as const;

export default async function SmsSettingsPage() {
  const ctx = await requirePermission("sms:manage");
  const s = await prisma.smsSettings.findUnique({ where: { businessId: ctx.business.id } });
  const events = s?.events ?? ["SALE_INVOICE", "PAYMENT_RECEIVED", "SALES_RETURN", "INVOICE_CANCELLED", "DUE_REMINDER", "PURCHASE", "SUPPLIER_PAYMENT", "PURCHASE_RETURN", "LOW_STOCK", "EXPIRY_WARNING", "EXPIRED"];
  const days = s?.expiryAlertDays ?? [90, 60, 30, 15, 7];
  const platform = platformConfig();
  const providers = availableProviders().filter((p) => p !== "platform" || platform);

  return (
    <>
      <PageHeader title="এসএমএস সেটিং" description="প্রোভাইডার, সেন্ডার আইডি, স্বয়ংক্রিয় এসএমএস ও ব্যালেন্স সতর্কতা" />
      <SmsTabs active="/sms/settings" canManage />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel lg:col-span-2">
          <div className="panel-head"><h2 className="panel-title">সেটিং</h2></div>
          <div className="p-4">
            <ActionForm action={saveSmsSettingsAction} className="space-y-5">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name="enabled" defaultChecked={s?.enabled ?? false} /> এসএমএস চালু
              </label>
              <fieldset className="grid gap-4 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-semibold text-ink-800">প্রোভাইডার</legend>
                <Field label="প্রোভাইডার" name="provider">
                  <select id="provider" name="provider" defaultValue={s?.provider ?? (platform ? "platform" : "mock")} className="input">
                    {providers.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p] ?? p}</option>)}
                  </select>
                </Field>
                <Field label="API কী" name="apiKey" hint={s?.apiKeyHint ? `সংরক্ষিত কী: ${s.apiKeyHint} — পরিবর্তন না করলে খালি রাখুন` : "এনক্রিপ্ট করে সংরক্ষণ হয়; কখনো আর দেখানো হয় না"}>
                  <input id="apiKey" name="apiKey" type="password" autoComplete="new-password" className="input" placeholder={s?.apiKeyHint ?? ""} />
                </Field>
                <Field label="সেন্ডার আইডি / মাস্কিং" name="senderId" hint="প্রোভাইডারে অনুমোদিত নাম বা নম্বর">
                  <input id="senderId" name="senderId" defaultValue={s?.senderId ?? ""} maxLength={20} className="input" />
                </Field>
                <Field label="কম ব্যালেন্স সতর্কতা" name="lowBalanceThreshold" hint="ব্যালেন্স এর নিচে নামলে নোটিফিকেশন">
                  <input id="lowBalanceThreshold" name="lowBalanceThreshold" type="number" min="0" step="1" defaultValue={s ? num(s.lowBalanceThreshold) : 100} className="input-num" />
                </Field>
                {s?.apiKeyHint && <label className="flex items-center gap-2 text-xs sm:col-span-2"><input type="checkbox" name="clearApiKey" /> সংরক্ষিত API কী মুছে ফেলুন</label>}
                <p className="text-xs text-slate-500 sm:col-span-2">
                  {platform ? `প্ল্যাটফর্ম প্রোভাইডার: সার্ভারে কনফিগার করা (${PROVIDER_LABELS[platform.provider] ?? platform.provider}) অ্যাকাউন্ট ব্যবহার হবে — আপনার কী লাগবে না।` : "সার্ভারে কোনো প্ল্যাটফর্ম প্রোভাইডার নেই — নিজের প্রোভাইডারের API কী দিন। “ডেমো” প্রোভাইডারে আসল এসএমএস যায় না।"}
                </p>
              </fieldset>

              <fieldset className="border-t border-rule pt-4">
                <legend className="mb-2 text-sm font-semibold text-ink-800">স্বয়ংক্রিয় এসএমএস</legend>
                <div className="grid gap-4 sm:grid-cols-3">
                  {GROUPS.map((g) => (
                    <div key={g.key}>
                      <p className="mb-1 text-xs font-semibold text-slate-500">{g.label}</p>
                      {SMS_EVENTS.filter((e) => e.group === g.key && e.automatic).map((e) => (
                        <label key={e.key} className="flex items-center gap-2 py-0.5 text-sm">
                          <input type="checkbox" name="events" value={e.key} defaultChecked={events.includes(e.key)} /> {e.label}
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset className="grid gap-4 border-t border-rule pt-4 sm:grid-cols-2">
                <legend className="mb-2 text-sm font-semibold text-ink-800">সতর্কতা</legend>
                <Field label="সতর্কতার মোবাইল নম্বর" name="alertMobiles" hint="কমা দিয়ে আলাদা করুন, সর্বোচ্চ ৫টি; খালি রাখলে ব্যবসার মোবাইলে যাবে">
                  <input id="alertMobiles" name="alertMobiles" defaultValue={(s?.alertMobiles ?? []).join(", ")} className="input" placeholder="01XXXXXXXXX, 01XXXXXXXXX" />
                </Field>
                <Field label="বকেয়া স্মরণ — প্রতি কত দিনে একবার" name="dueReminderEveryDays">
                  <input id="dueReminderEveryDays" name="dueReminderEveryDays" type="number" min="1" max="90" defaultValue={s?.dueReminderEveryDays ?? 7} className="input-num" />
                </Field>
                <div className="sm:col-span-2">
                  <p className="label">মেয়াদ শেষের কত দিন আগে এসএমএস (প্রতিটি ধাপে একবার)</p>
                  <div className="flex flex-wrap gap-2">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <input key={i} name="expiryAlertDays" type="number" min="1" max="365" defaultValue={days[i] ?? ""} className="input-num w-20" aria-label={`সতর্কতা ${i + 1}`} />
                    ))}
                  </div>
                </div>
              </fieldset>
              <SubmitButton>সংরক্ষণ করুন</SubmitButton>
            </ActionForm>
          </div>
        </section>

        <div className="space-y-4">
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">টেস্ট এসএমএস</h2></div>
            <div className="p-4">
              <ActionForm action={sendTestSmsAction} className="space-y-3">
                <Field label="মোবাইল নম্বর" name="testMobile">
                  <input id="testMobile" name="testMobile" type="tel" className="input" placeholder="01XXXXXXXXX" defaultValue={ctx.user.mobile ?? ""} />
                </Field>
                <SubmitButton className="btn-secondary" pendingText="পাঠানো হচ্ছে…">টেস্ট এসএমএস পাঠান</SubmitButton>
              </ActionForm>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">ব্যালেন্স</h2></div>
            <div className="space-y-2 p-4 text-sm">
              <p className="text-2xl font-bold">{s?.balance !== null && s?.balance !== undefined ? formatNumber(num(s.balance)) : "—"}</p>
              {s?.balanceCheckedAt && <p className="text-xs text-slate-500">হালনাগাদ {formatDateTime(s.balanceCheckedAt)}</p>}
              <ActionButton action={refreshSmsBalanceAction} label="↻ ব্যালেন্স দেখুন" className="btn-secondary btn-sm" />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

"use client";

// "ব্যবসার ধরন ও মডিউল ব্যবস্থাপনা": the owner ticks any number of business types; the modules they switch on are shown live.
import { useState } from "react";
import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { BUSINESS_TYPE_LABELS, businessModules, MODULE_LABELS, type BusinessModule, type BusinessTypeKey } from "@/lib/business-types";
import { useT } from "@/components/lang";

const MODULE_HINTS: Record<BusinessModule, string> = {
  TRADING: "পস বিক্রয়, বিক্রয়/ক্রয় ভাউচার, ফেরত, স্টক জার্নাল ও পণ্য মেনু",
  DEPOT: "ডিপো ড্যাশবোর্ড, ডেলিভারি চালান, ডিলার, ডিপো পণ্য, কোম্পানি কমিশন, ডিপো ক্যাশ ও রিপোর্ট",
  RICE_MILL: "ধান ক্রয় ও স্কেল, মিলিং, চাল ও উপজাত স্টক, চাল/কুঁড়া/ভূসি বিক্রয় ও মিল রিপোর্ট",
};

export function BusinessTypesForm({ action, selected, canEdit }: { action: FormAction; selected: string[]; canEdit: boolean }) {
  const t = useT();
  const [types, setTypes] = useState<string[]>(selected);
  const on = businessModules(types);
  const toggle = (t: string, checked: boolean) => setTypes((cur) => (checked ? [...cur, t] : cur.filter((x) => x !== t)));
  return (
    <ActionForm action={action} className="space-y-4">
      <fieldset disabled={!canEdit} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" id="business-types">
        {(Object.keys(BUSINESS_TYPE_LABELS) as BusinessTypeKey[]).map((k) => (
          <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${types.includes(k) ? "border-brand-500 bg-brand-50" : "border-rule"}`}>
            <input type="checkbox" id={`bt-${k}`} name="businessTypes" value={k} checked={types.includes(k)} onChange={(e) => toggle(k, e.target.checked)} />
            {t(BUSINESS_TYPE_LABELS[k])}
          </label>
        ))}
      </fieldset>
      <div className="rounded-md border border-rule bg-slate-50 p-3 text-sm" id="business-modules">
        <p className="mb-1 font-semibold text-ink-900">{t("যে মডিউলগুলো চালু থাকবে")}</p>
        <ul className="space-y-1">
          <li>✔ {t("মূল মডিউল — ড্যাশবোর্ড, হিসাব/লেজার, কাস্টমার, সরবরাহকারী, খরচ, রিপোর্ট ও সেটিং (সবসময়)")}</li>
          {(Object.keys(MODULE_LABELS) as BusinessModule[]).map((m) => (
            <li key={m} className={on.has(m) ? "" : "text-slate-400 line-through"}>
              {on.has(m) ? "✔" : "✖"} {t(MODULE_LABELS[m])} <span className="text-xs text-slate-500">— {t(MODULE_HINTS[m])}</span>
            </li>
          ))}
        </ul>
        {types.length === 0 && <p className="mt-1 text-xs text-slate-500">{t("কিছু বাছাই না করলে এটি সাধারণ ব্যবসা — বিক্রয়, পস ও ইনভেন্টরি চালু থাকে।")}</p>}
        <p className="mt-1 text-xs text-slate-500">{t("কোনো ধরন বন্ধ করলে তার মেনু লুকায়; আগের তথ্য মুছে যায় না, আবার চালু করলে ফিরে আসে।")}</p>
      </div>
      {canEdit ? <SubmitButton>{t("ব্যবসার ধরন সংরক্ষণ করুন")}</SubmitButton> : <p className="text-sm text-slate-500">{t("শুধু ব্যবসার মালিক এটি পরিবর্তন করতে পারেন।")}</p>}
    </ActionForm>
  );
}

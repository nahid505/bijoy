"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { useToast } from "@/components/toaster";
import { registerAction, requestRegistrationOtpAction } from "@/server/actions/auth";

const rules = (pw: string) => [
  { ok: pw.length >= 8, text: "কমপক্ষে ৮ অক্ষর" },
  { ok: /[A-Za-zঀ-৿]/.test(pw), text: "অন্তত একটি অক্ষর" },
  { ok: /[0-9০-৯]/.test(pw), text: "অন্তত একটি সংখ্যা" },
];

/** Sends the verification code to the number typed in the mobile field (60 s between codes). */
function SendCodeButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const send = async () => {
    const mobile = (document.getElementById("mobile") as HTMLInputElement | null)?.value ?? "";
    const fd = new FormData();
    fd.set("mobile", mobile);
    setBusy(true);
    try {
      const r = await requestRegistrationOtpAction(null, fd);
      toast(r?.errors?.mobile?.[0] ?? r?.message ?? "", r?.ok ? "success" : "error");
      if (r?.ok) {
        setWait(60);
        const t = setInterval(() => setWait((w) => (w <= 1 ? (clearInterval(t), 0) : w - 1)), 1000);
        document.getElementById("otp")?.focus();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn-secondary shrink-0" disabled={busy || wait > 0} onClick={send}>
      {busy ? "পাঠানো হচ্ছে…" : wait ? `${String(wait).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])} সে.` : "কোড পাঠান"}
    </button>
  );
}

export function RegisterForm({ otpRequired = false }: { otpRequired?: boolean }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  return (
    <ActionForm action={registerAction} className="space-y-4">
      {/* honeypot: hidden from people and screen readers; bots that fill it are refused */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <Field label="ব্যবসার/প্রতিষ্ঠানের নাম *" name="businessName">
        <input id="businessName" name="businessName" required maxLength={120} autoComplete="organization" className="input" placeholder="যেমন: রহমান এন্টারপ্রাইজ" />
      </Field>
      <Field label="মালিকের নাম *" name="ownerName">
        <input id="ownerName" name="ownerName" required maxLength={100} autoComplete="name" className="input" />
      </Field>
      <Field label="মোবাইল নম্বর *" name="mobile" hint="এই নম্বর দিয়েই লগইন করবেন">
        <div className="flex gap-2">
          <input id="mobile" name="mobile" type="tel" inputMode="tel" required maxLength={20} autoComplete="tel" className="input" placeholder="01XXXXXXXXX" />
          {otpRequired && <SendCodeButton />}
        </div>
      </Field>
      {otpRequired && (
        <Field label="মোবাইলে পাঠানো কোড *" name="otp" hint="নম্বরটি আপনার কিনা যাচাই করতে — ৫ মিনিট বৈধ">
          <input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="input tracking-[0.4em]" placeholder="••••••" />
        </Field>
      )}
      <Field label="ইমেইল (ঐচ্ছিক)" name="email">
        <input id="email" name="email" type="email" maxLength={200} autoComplete="email" className="input" placeholder="you@example.com" />
      </Field>
      <Field label="পাসওয়ার্ড *" name="password">
        <input id="password" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby="pw-rules" />
        <ul id="pw-rules" className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
          {rules(pw).map((r) => (
            <li key={r.text} className={r.ok ? "text-brand-700" : "text-slate-400"}>{r.ok ? "✔" : "○"} {r.text}</li>
          ))}
        </ul>
      </Field>
      <Field label="পাসওয়ার্ড নিশ্চিত করুন *" name="confirmPassword">
        <input id="confirmPassword" name="confirmPassword" type="password" required maxLength={128} autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {confirm && confirm !== pw && <p className="mt-1 text-xs text-red-600">পাসওয়ার্ড দুটি মিলছে না</p>}
      </Field>
      <SubmitButton className="btn-primary w-full" pendingText="অ্যাকাউন্ট তৈরি হচ্ছে…">
        অ্যাকাউন্ট তৈরি করুন
      </SubmitButton>
      <p className="text-[11px] leading-relaxed text-slate-500">
        অ্যাকাউন্ট তৈরি হলে আপনার ব্যবসার জন্য আলাদা হিসাবের খাত (চার্ট অব অ্যাকাউন্টস), ইউনিট, গুদাম ও রোল স্বয়ংক্রিয়ভাবে তৈরি হবে। আপনি এর মালিক (Owner) থাকবেন।
      </p>
    </ActionForm>
  );
}

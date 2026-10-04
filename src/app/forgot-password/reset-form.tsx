"use client";

import { startTransition, useActionState } from "react";
import { FormAlert } from "@/components/forms";
import { requestPasswordResetAction, resetPasswordAction } from "@/server/actions/auth";

type State = { ok: boolean; message?: string; errors?: Record<string, string[]>; data?: Record<string, string> } | null;
const err = (s: State, k: string) => s?.errors?.[k]?.[0];

export function ResetPasswordForm() {
  const [sent, request, requesting] = useActionState(requestPasswordResetAction, null as State);
  const [reset, submit, resetting] = useActionState(resetPasswordAction, null as State);
  const mobile = reset?.data?.mobile ?? sent?.data?.mobile;
  const onSubmit = (fn: (fd: FormData) => void) => (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => fn(fd));
  };

  if (!mobile) {
    return (
      <form onSubmit={onSubmit(request)} className="space-y-4" noValidate>
        <FormAlert state={sent} />
        <div>
          <label className="label" htmlFor="mobile">আপনার মোবাইল নম্বর</label>
          <input id="mobile" name="mobile" type="tel" inputMode="tel" autoComplete="tel" required className="input" placeholder="01XXXXXXXXX" />
          {err(sent, "mobile") && <p className="mt-1 text-xs text-red-600">{err(sent, "mobile")}</p>}
        </div>
        <button type="submit" className="btn-primary w-full" disabled={requesting}>{requesting ? "পাঠানো হচ্ছে…" : "কোড পাঠান"}</button>
      </form>
    );
  }
  return (
    <form onSubmit={onSubmit(submit)} className="space-y-4" noValidate>
      <FormAlert state={reset ?? sent} />
      <input type="hidden" name="mobile" value={mobile} />
      <div>
        <label className="label" htmlFor="otp">৬ অঙ্কের কোড</label>
        <input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus className="input text-center text-lg tracking-[0.5em]" />
        {err(reset, "otp") && <p className="mt-1 text-xs text-red-600">{err(reset, "otp")}</p>}
      </div>
      <div>
        <label className="label" htmlFor="newPassword">নতুন পাসওয়ার্ড</label>
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required className="input" />
        {err(reset, "newPassword") && <p className="mt-1 text-xs text-red-600">{err(reset, "newPassword")}</p>}
      </div>
      <div>
        <label className="label" htmlFor="confirmPassword">নতুন পাসওয়ার্ড নিশ্চিত করুন</label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className="input" />
        {err(reset, "confirmPassword") && <p className="mt-1 text-xs text-red-600">{err(reset, "confirmPassword")}</p>}
      </div>
      <button type="submit" className="btn-primary w-full" disabled={resetting}>{resetting ? "সংরক্ষণ হচ্ছে…" : "পাসওয়ার্ড পরিবর্তন করুন"}</button>
      <p className="text-[11px] text-slate-500">পরিবর্তনের পর সব ডিভাইস থেকে লগআউট হয়ে যাবে।</p>
    </form>
  );
}

"use client";

import Link from "next/link";
import { ActionForm, Field, SubmitButton, useFormCtx } from "@/components/forms";
import { loginAction } from "@/server/actions/auth";

function Fields({ next, resetAvailable }: { next: string; resetAvailable: boolean }) {
  const { state } = useFormCtx();
  const otp = state?.data?.step === "otp" ? state.data : null;
  if (otp) {
    // second step: the password was correct, now the SMS code
    return (
      <>
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="challenge" value={otp.challenge} />
        <Field label={`${otp.mobile} নম্বরে পাঠানো কোড`} name="otp" hint="৫ মিনিট বৈধ">
          <input id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9০-৯]{6}" maxLength={6} required autoFocus className="input text-center text-lg tracking-[0.5em]" />
        </Field>
        <SubmitButton className="btn-primary w-full" pendingText="যাচাই হচ্ছে…">যাচাই করে লগইন</SubmitButton>
        <a href="/login" className="block text-center text-xs text-slate-500 hover:underline">আবার শুরু করুন</a>
      </>
    );
  }
  return (
    <>
      <input type="hidden" name="next" value={next} />
      <Field label="মোবাইল নম্বর বা ইমেইল" name="email">
        <input id="email" name="email" type="text" inputMode="email" autoComplete="username" required className="input" placeholder="01XXXXXXXXX বা you@example.com" />
      </Field>
      <Field label="পাসওয়ার্ড" name="password">
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </Field>
      <SubmitButton className="btn-primary w-full" pendingText="প্রবেশ করা হচ্ছে…">
        লগইন
      </SubmitButton>
      {resetAvailable && (
        <Link prefetch={false} href="/forgot-password" className="block text-center text-xs text-brand-700 hover:underline">
          পাসওয়ার্ড ভুলে গেছেন?
        </Link>
      )}
    </>
  );
}

export function LoginForm({ next, resetAvailable = false }: { next: string; resetAvailable?: boolean }) {
  return (
    <ActionForm action={loginAction}>
      <Fields next={next} resetAvailable={resetAvailable} />
    </ActionForm>
  );
}

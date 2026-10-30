"use client";

import { useActionState, startTransition } from "react";
import Link from "next/link";
import { FormAlert } from "@/components/forms";
import { resetPasswordAction } from "@/server/actions/auth";

type State = { ok: boolean; message?: string; errors?: Record<string, string[]>; data?: Record<string, string> } | null;
const err = (s: State, k: string) => s?.errors?.[k]?.[0];

export function ResetPasswordForm({ identifier }: { identifier?: string }) {
  const [state, submit, resetting] = useActionState(resetPasswordAction, null as State);
  const activeIdentifier = identifier || state?.data?.identifier || state?.data?.mobile || "";

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => submit(fd));
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormAlert state={state} />

      {activeIdentifier ? (
        <div>
          <input type="hidden" name="identifier" value={activeIdentifier} />
          <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <span className="text-slate-600">কোড পাঠানো হয়েছে:</span>
            <span className="font-semibold text-slate-800">{activeIdentifier}</span>
          </div>
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="identifier">মোবাইল নম্বর বা ইমেইল</label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            required
            autoFocus
            className="input"
            placeholder="01XXXXXXXXX / user@example.com"
          />
          {err(state, "identifier") && <p className="mt-1 text-xs text-red-600">{err(state, "identifier")}</p>}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="otp">৬ অঙ্কের কোড</label>
          <span className="text-[11px] text-slate-400">মেয়াদ ৫ মিনিট</span>
        </div>
        <input
          id="otp"
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus={Boolean(activeIdentifier)}
          placeholder="••••••"
          className="input text-center text-xl font-bold tracking-[0.5em]"
        />
        {err(state, "otp") && <p className="mt-1 text-xs text-red-600">{err(state, "otp")}</p>}
      </div>

      <div>
        <label className="label" htmlFor="newPassword">নতুন পাসওয়ার্ড</label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          className="input"
          placeholder="••••••••"
        />
        {err(state, "newPassword") && <p className="mt-1 text-xs text-red-600">{err(state, "newPassword")}</p>}
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">নতুন পাসওয়ার্ড নিশ্চিত করুন</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className="input"
        />
        {err(state, "confirmPassword") && <p className="mt-1 text-xs text-red-600">{err(state, "confirmPassword")}</p>}
      </div>

      <button type="submit" className="btn-primary w-full" disabled={resetting}>
        {resetting ? "সংরক্ষণ হচ্ছে…" : "পাসওয়ার্ড পরিবর্তন করুন"}
      </button>

      <div className="flex items-center justify-between pt-1 text-xs">
        <Link prefetch={false} href="/forgot-password" className="text-slate-500 hover:text-brand-700 hover:underline">
          কোড পাননি? আবার পাঠান
        </Link>
        <Link prefetch={false} href="/login" className="text-brand-700 hover:underline">
          লগইনে ফিরে যান
        </Link>
      </div>

      <p className="text-[11px] text-slate-500 text-center">
        পরিবর্তনের পর সব ডিভাইস থেকে লগআউট হয়ে যাবে।
      </p>
    </form>
  );
}

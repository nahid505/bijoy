"use client";

import { useEffect, useActionState, startTransition } from "react";
import { useRouter } from "next/navigation";
import { FormAlert } from "@/components/forms";
import { requestPasswordResetAction } from "@/server/actions/auth";

type State = { ok: boolean; message?: string; errors?: Record<string, string[]>; data?: Record<string, string> } | null;
const err = (s: State, k: string) => s?.errors?.[k]?.[0];

export function ForgotPasswordForm() {
  const router = useRouter();
  const [state, request, requesting] = useActionState(requestPasswordResetAction, null as State);

  useEffect(() => {
    if (state?.ok && (state.data?.identifier || state.data?.mobile)) {
      const id = state.data.identifier || state.data.mobile;
      router.push(`/reset-password?identifier=${encodeURIComponent(id)}`);
    }
  }, [state, router]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => request(fd));
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormAlert state={state} />
      <div>
        <label className="label" htmlFor="identifier">মোবাইল নম্বর বা ইমেইল</label>
        <input
          id="identifier"
          name="identifier"
          type="text"
          autoComplete="username"
          required
          autoFocus
          className="input"
          placeholder="01XXXXXXXXX / user@example.com"
        />
        {err(state, "identifier") && <p className="mt-1 text-xs text-red-600">{err(state, "identifier")}</p>}
        {err(state, "mobile") && !err(state, "identifier") && <p className="mt-1 text-xs text-red-600">{err(state, "mobile")}</p>}
      </div>
      <button type="submit" className="btn-primary w-full" disabled={requesting}>
        {requesting ? "পাঠানো হচ্ছে…" : "কোড পাঠান"}
      </button>
      <p className="text-[11px] text-slate-500">
        আপনার নিবন্ধিত নম্বরে এসএমএস বা ইমেইলে ৬ অঙ্কের ওটিপি কোড পাঠানো হবে (৫ মিনিট বৈধ)।
      </p>
    </form>
  );
}

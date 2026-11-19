"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AppError]", error);
  }, [error]);

  return (
    <div className="card mx-auto mt-16 max-w-lg p-10 text-center shadow-md">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-3xl">
        ⚠️
      </div>
      <h1 className="mt-4 text-xl font-bold text-slate-800">কিছু একটা ভুল হয়েছে</h1>
      <p className="mt-2 text-sm text-slate-500">
        অনুগ্রহ করে আবার চেষ্টা করুন। সমস্যা থাকলে অ্যাডমিনকে জানান।
      </p>

      {error?.message && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 text-left">
          <p className="text-xs font-semibold text-amber-800">ত্রুটির বিবরণ (Error Message):</p>
          <p className="mt-1 font-mono text-xs leading-relaxed text-amber-950 break-words whitespace-pre-wrap select-all">
            {error.message}
          </p>
          {error.digest && (
            <p className="mt-1.5 font-mono text-[10px] text-slate-400">Digest: {error.digest}</p>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="btn-primary">
          আবার চেষ্টা করুন
        </button>
        <Link prefetch={false} href="/" className="btn-secondary">
          হোম পেজে ফিরুন
        </Link>
      </div>
    </div>
  );
}

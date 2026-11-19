"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DashboardError]", error);
  }, [error]);

  return (
    <div className="card mx-auto mt-12 max-w-xl p-8 text-center shadow-md">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-3xl text-rose-600">
        ⚠️
      </div>
      <h1 className="mt-4 text-xl font-bold text-slate-800">ড্যাশবোর্ড লোড করতে সমস্যা হয়েছে</h1>
      <p className="mt-2 text-sm text-slate-500">
        ড্যাশবোর্ডের কোনো তথ্য লোড করার সময় ত্রুটি ঘটেছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।
      </p>

      {error?.message && (
        <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50/80 p-3.5 text-left">
          <p className="text-xs font-semibold text-rose-800">ত্রুটির বিবরণ (Error Message):</p>
          <p className="mt-1 font-mono text-xs leading-relaxed text-rose-950 break-words whitespace-pre-wrap select-all">
            {error.message}
          </p>
          {error.digest && (
            <p className="mt-1.5 font-mono text-[10px] text-slate-400">Digest: {error.digest}</p>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="btn-primary min-h-[40px]">
          আবার চেষ্টা করুন
        </button>
        <Link prefetch={false} href="/" className="btn-secondary min-h-[40px]">
          মূল পাতা
        </Link>
      </div>
    </div>
  );
}

"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-16 max-w-lg p-10 text-center">
      <p className="text-5xl">⚠️</p>
      <h1 className="mt-4 text-xl font-bold text-slate-800">কিছু একটা ভুল হয়েছে</h1>
      <p className="mt-2 text-sm text-slate-500">অনুগ্রহ করে আবার চেষ্টা করুন। সমস্যা থাকলে অ্যাডমিনকে জানান।</p>
      <button type="button" onClick={reset} className="btn-primary mt-6">
        আবার চেষ্টা করুন
      </button>
    </div>
  );
}

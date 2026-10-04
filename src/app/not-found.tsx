import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card max-w-md p-10 text-center">
        <p className="text-5xl font-bold text-brand-600">৪০৪</p>
        <h1 className="mt-3 text-lg font-semibold text-slate-800">পৃষ্ঠাটি পাওয়া যায়নি</h1>
        <Link prefetch={false} href="/dashboard" className="btn-primary mt-6">
          ড্যাশবোর্ডে ফিরুন
        </Link>
      </div>
    </div>
  );
}

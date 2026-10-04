import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="card mx-auto mt-16 max-w-lg p-10 text-center">
      <p className="text-5xl">🔒</p>
      <h1 className="mt-4 text-xl font-bold text-slate-800">প্রবেশাধিকার নেই</h1>
      <p className="mt-2 text-sm text-slate-500">এই পৃষ্ঠা দেখার অনুমতি আপনার রোলে নেই। প্রয়োজনে অ্যাডমিনের সাথে যোগাযোগ করুন।</p>
      <Link prefetch={false} href="/dashboard" className="btn-primary mt-6">
        ড্যাশবোর্ডে ফিরুন
      </Link>
    </div>
  );
}

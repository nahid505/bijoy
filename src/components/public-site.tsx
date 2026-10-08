// Header and footer of the public pages (landing, pricing).
import Link from "next/link";

export function PublicHeader({ loggedIn }: { loggedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link prefetch={false} href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-lg font-bold text-white">৳</span>
          <span className="text-lg font-bold text-ink-900">বিজয় লেনদেন</span>
        </Link>
        <nav aria-label="প্রধান" className="hidden items-center gap-5 text-sm text-slate-700 md:flex">
          <Link prefetch={false} href="/#features" className="hover:text-brand-700">ফিচার</Link>
          <Link prefetch={false} href="/pricing" className="hover:text-brand-700">মূল্য</Link>
          <Link prefetch={false} href="/#faq" className="hover:text-brand-700">প্রশ্নোত্তর</Link>
          <Link prefetch={false} href="/#contact" className="hover:text-brand-700">যোগাযোগ</Link>
        </nav>
        <div className="flex items-center gap-2">
          {loggedIn ? (
            <Link prefetch={false} href="/dashboard" className="btn-primary">ড্যাশবোর্ড →</Link>
          ) : (
            <>
              <Link prefetch={false} href="/login" className="btn-ghost">লগইন</Link>
              <Link prefetch={false} href="/register" className="btn-primary">ফ্রি শুরু করুন</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-rule bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>© বিজয় লেনদেন — বাংলায় ব্যবসার হিসাব</p>
        <nav aria-label="ফুটার" className="flex flex-wrap gap-4">
          <Link prefetch={false} href="/pricing" className="hover:text-brand-700">মূল্য</Link>
          <Link prefetch={false} href="/login" className="hover:text-brand-700">লগইন</Link>
          <Link prefetch={false} href="/register" className="hover:text-brand-700">রেজিস্ট্রেশন</Link>
        </nav>
      </div>
    </footer>
  );
}

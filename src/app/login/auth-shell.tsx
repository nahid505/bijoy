// Shared frame of the login and registration pages: brand panel (desktop) + form column.
export function AuthShell({ title, subtitle, children, footer, wide = false }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-screen bg-paper">
      <section className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-ink-900 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-brand-600 text-2xl font-bold">৳</span>
          <span className="text-2xl font-bold">বিজয় লেনদেন</span>
        </div>
        <div>
          <p className="text-3xl font-bold leading-snug">ডাবল-এন্ট্রি হিসাব,<br />সহজ বাংলায়।</p>
          <ul className="mt-6 space-y-2 text-sm text-ink-100">
            <li>✔ প্রতিটি লেনদেনে ডেবিট = ক্রেডিট নিশ্চিত</li>
            <li>✔ লেজার, ডে বুক, ট্রায়াল ব্যালেন্স, লাভ-ক্ষতি, ব্যালান্স শীট</li>
            <li>✔ বিক্রয়-ক্রয়, ফেরত ও স্বয়ংক্রিয় স্টক হিসাব</li>
            <li>✔ একাধিক ব্যবসা ও রোলভিত্তিক অনুমতি</li>
          </ul>
        </div>
        {/* ledger-paper motif */}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-10 w-px bg-brand-500/40" />
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 28px)" }} />
        <p className="text-xs text-ink-200">© বিজয় লেনদেন</p>
      </section>
      <section className="flex flex-1 items-center justify-center px-4 py-10">
        <div className={`w-full ${wide ? "max-w-md" : "max-w-sm"}`}>
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-600 text-lg font-bold text-white">৳</span>
            <span className="text-xl font-bold text-ink-900">বিজয় লেনদেন</span>
          </div>
          <h1 className="text-xl font-bold text-ink-900">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>
          <div className="panel p-6">{children}</div>
          {footer && <div className="mt-5 text-center text-sm text-slate-600">{footer}</div>}
        </div>
      </section>
    </main>
  );
}

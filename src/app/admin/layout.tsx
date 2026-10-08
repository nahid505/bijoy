import Link from "next/link";
import { requireSuperAdmin } from "@/server/super-admin";
import { logoutAction } from "@/server/actions/auth";
import { prisma } from "@/lib/db";
import { toBnDigits } from "@/lib/format";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/admin", label: "ড্যাশবোর্ড" },
  { href: "/admin/companies", label: "কোম্পানি" },
  { href: "/admin/users", label: "ব্যবহারকারী" },
  { href: "/admin/plans", label: "প্ল্যান" },
  { href: "/admin/features", label: "ফিচার" },
  { href: "/admin/subscriptions", label: "সাবস্ক্রিপশন" },
  { href: "/admin/payments", label: "পেমেন্ট" },
  { href: "/admin/revenue", label: "আয়" },
  { href: "/admin/invoices", label: "ইনভয়েস" },
  { href: "/admin/audit", label: "অডিট লগ" },
  { href: "/admin/settings", label: "সেটিং" },
];

/** Super Admin panel (platform scope) — separate from the company app; 404 for everyone else. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();
  const pending = await prisma.paymentTransaction.count({ where: { status: "PENDING" } });
  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-ink-800 bg-ink-900 text-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-6">
          <Link prefetch={false} href="/admin" className="font-bold">বিজয় লেনদেন <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-ink-950">Super Admin</span></Link>
          <nav className="flex flex-1 flex-wrap gap-1 text-sm" aria-label="সুপার অ্যাডমিন মেনু">
            {LINKS.map((l) => (
              <Link key={l.href} prefetch={false} href={l.href} className="rounded px-2.5 py-1 text-ink-100 hover:bg-ink-800 hover:text-white">
                {l.label}{l.href === "/admin/payments" && pending > 0 && <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-ink-950">{toBnDigits(pending)}</span>}
              </Link>
            ))}
          </nav>
          <span className="hidden text-xs text-ink-200 sm:inline">{user.name}</span>
          <Link prefetch={false} href="/dashboard" className="rounded border border-ink-600 px-2 py-1 text-xs hover:bg-ink-800">অ্যাপে ফিরুন</Link>
          <form action={logoutAction}><button type="submit" className="rounded border border-ink-600 px-2 py-1 text-xs hover:bg-ink-800">লগআউট</button></form>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6">{children}</main>
    </div>
  );
}

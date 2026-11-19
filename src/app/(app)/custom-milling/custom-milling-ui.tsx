"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MillRoleType } from "@/lib/custom-milling";

export function CustomMillingTabs({ role }: { role: MillRoleType }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sim = searchParams.get("role");

  const withRoleParam = (href: string) => {
    if (!sim) return href;
    const url = new URL(href, "http://localhost");
    url.searchParams.set("role", sim);
    return `${url.pathname}?${url.searchParams.toString()}`;
  };

  const tabs = [
    { href: "/custom-milling", label: "📊 ড্যাশবোর্ড", exact: true },
    { href: "/custom-milling/batches", label: "⚖️ ধান গ্রহণ ও স্কেল" },
    { href: "/custom-milling/expenses", label: "💸 মিল খরচ" },
    { href: "/custom-milling/vouchers", label: "💵 ক্যাশ বুক ও ভাউচার" },
    { href: "/custom-milling/parties", label: "👥 পার্টি লেজার" },
    ...(role !== "MILL_ACCOUNTANT"
      ? [{ href: "/custom-milling/reports", label: "🤝 ৬০:৪০ পার্টনারশিপ হিসাব" }]
      : []),
    ...(role !== "MILL_ACCOUNTANT"
      ? [{ href: "/custom-milling/settings", label: "⚙️ সেটিংস" }]
      : []),
  ];

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-2">
      <nav className="flex flex-wrap items-center gap-1.5 sm:gap-2" aria-label="Custom Milling Navigation">
        {tabs.map((tab) => {
          const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={withRoleParam(tab.href)}
              prefetch={false}
              className={`rounded-lg px-3 py-1.5 text-xs sm:text-sm font-semibold transition ${
                isActive
                  ? "bg-brand-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        <MillRoleBadge role={role} />
      </div>
    </div>
  );
}

export function MillRoleBadge({ role }: { role: MillRoleType }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleRoleChange = (newRole: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newRole) {
      params.set("role", newRole);
    } else {
      params.delete("role");
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  const labels: Record<MillRoleType, { text: string; bg: string; dot: string }> = {
    SUPER_ADMIN: {
      text: "👑 সুপার অ্যাডমিন (নাহিদ হাসান - ৬০%)",
      bg: "bg-amber-100 text-amber-900 border-amber-300",
      dot: "bg-amber-600",
    },
    MILL_ACCOUNTANT: {
      text: "📝 হিসাবরক্ষক (আজকের এন্ট্রি শুধু)",
      bg: "bg-sky-100 text-sky-900 border-sky-300",
      dot: "bg-sky-600",
    },
    MILL_PARTNER: {
      text: "👀 পার্টনার (৪০% - শুধুমাত্র দেখা)",
      bg: "bg-emerald-100 text-emerald-900 border-emerald-300",
      dot: "bg-emerald-600",
    },
  };

  const current = labels[role];

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${current.bg}`}
      >
        <span className={`h-2 w-2 rounded-full ${current.dot}`} />
        <span>{current.text}</span>
      </span>

      {/* Development / Testing Role Simulator */}
      <select
        value={searchParams.get("role") || ""}
        onChange={(e) => handleRoleChange(e.target.value)}
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600"
        title="রোল সিমুলেটর (টেস্টিং)"
      >
        <option value="">স্বাভাবিক রোল</option>
        <option value="SUPER_ADMIN">👑 সুপার অ্যাডমিন (৬০%)</option>
        <option value="MILL_ACCOUNTANT">📝 হিসাবরক্ষক (Accountant)</option>
        <option value="MILL_PARTNER">👀 পার্টনার (৪০% Read-only)</option>
      </select>
    </div>
  );
}

export function BatchStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string }> = {
    RECEIVED: { label: "📥 ধান গৃহীত (স্কেল)", bg: "bg-sky-100 text-sky-800 border-sky-300" },
    IN_DRYER: { label: "🔥 ড্রায়ারে চলমান", bg: "bg-amber-100 text-amber-800 border-amber-300" },
    MILLED: { label: "⚙️ মিলিং সম্পন্ন", bg: "bg-indigo-100 text-indigo-800 border-indigo-300" },
    DELIVERED: { label: "🚚 চাল ও উপজাত ডেলিভার্ড", bg: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  };

  const item = map[status] || { label: status, bg: "bg-slate-100 text-slate-700 border-slate-300" };

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${item.bg}`}>
      {item.label}
    </span>
  );
}

export function MainSyncBadge({ status }: { status: string }) {
  if (status === "NOT_APPLICABLE") return null;

  const map: Record<string, { label: string; bg: string }> = {
    PENDING: { label: "⏳ মূল হিসাবে সিঙ্ক পেন্ডিং", bg: "bg-yellow-100 text-yellow-800 border-yellow-300" },
    POSTED: { label: "✅ মূল হিসাবে অন্তর্ভুক্ত", bg: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    REJECTED: { label: "❌ ব্রিজ সিঙ্ক বাতিল", bg: "bg-red-100 text-red-800 border-red-300" },
  };

  const item = map[status] || { label: status, bg: "bg-slate-100 text-slate-700 border-slate-300" };

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${item.bg}`}>
      {item.label}
    </span>
  );
}

export function PrintButton({ label = "প্রিন্ট করুন" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50"
    >
      <span>🖨️</span>
      <span>{label}</span>
    </button>
  );
}

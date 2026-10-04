import Link from "next/link";
import { Badge } from "@/components/ui";
import { SMS_STATUS_LABELS } from "@/lib/sms-text";

const TONE = { QUEUED: "slate", SENDING: "blue", SENT: "blue", DELIVERED: "green", FAILED: "red" } as const;

export function SmsStatusBadge({ status, retrying }: { status: string; retrying?: boolean }) {
  return <Badge tone={TONE[status as keyof typeof TONE] ?? "slate"}>{retrying ? "পুনরায় চেষ্টা হবে" : SMS_STATUS_LABELS[status] ?? status}</Badge>;
}

export function SmsTabs({ active, canManage }: { active: string; canManage: boolean }) {
  const tabs = [
    { href: "/sms", label: "ড্যাশবোর্ড" },
    { href: "/sms/log", label: "এসএমএস লগ" },
    { href: "/sms/compose", label: "এসএমএস পাঠান" },
    ...(canManage ? [{ href: "/sms/templates", label: "টেমপ্লেট" }, { href: "/sms/settings", label: "সেটিং" }] : []),
  ];
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-rule" aria-label="এসএমএস">
      {tabs.map((t) => (
        <Link
          prefetch={false}
          key={t.href}
          href={t.href}
          aria-current={active === t.href ? "page" : undefined}
          className={`rounded-t-md px-3 py-2 text-sm ${active === t.href ? "border border-b-paper border-rule bg-white font-semibold text-ink-900" : "text-slate-500 hover:text-ink-900"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

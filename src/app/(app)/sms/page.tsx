import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatDateTime, formatMoney, formatNumber, toBnDigits } from "@/lib/format";
import { SMS_EVENT } from "@/lib/sms-text";
import { EmptyState, PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { businessToday } from "@/server/services/notifications";
import { PROVIDER_LABELS } from "@/server/sms/providers";
import { SmsStatusBadge, SmsTabs } from "./sms-ui";

export const metadata: Metadata = { title: "এসএমএস" };

export default async function SmsDashboard() {
  const ctx = await requirePermission("sms:view");
  const businessId = ctx.business.id;
  const todayStart = new Date(businessToday().getTime() - 6 * 3600_000); // Dhaka midnight in UTC
  const monthStart = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1));
  const [settings, byStatus, today, month, recent] = await Promise.all([
    prisma.smsSettings.findUnique({ where: { businessId } }),
    prisma.smsMessage.groupBy({ by: ["status"], where: { businessId, createdAt: { gte: todayStart } }, _count: true, _sum: { parts: true } }),
    prisma.smsMessage.aggregate({ where: { businessId, createdAt: { gte: todayStart } }, _count: true, _sum: { parts: true, cost: true } }),
    prisma.smsMessage.aggregate({ where: { businessId, createdAt: { gte: monthStart }, status: { in: ["SENT", "DELIVERED"] } }, _count: true, _sum: { parts: true, cost: true } }),
    prisma.smsMessage.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 10, include: { customer: { select: { name: true } }, supplier: { select: { name: true } } } }),
  ]);
  const count = (s: string) => byStatus.find((x) => x.status === s)?._count ?? 0;
  const retrying = await prisma.smsMessage.count({ where: { businessId, status: "QUEUED", attempts: { gt: 0 } } });
  const daysSoFar = Math.max(1, todayStart.getUTCDate());
  const perDay = (month._sum.parts ?? 0) / daysSoFar;
  const balance = settings?.balance !== null && settings?.balance !== undefined ? num(settings.balance) : null;
  const lowBalance = balance !== null && settings && balance < num(settings.lowBalanceThreshold);
  const costPerDay = num(month._sum.cost) / daysSoFar;
  const daysLeft = balance !== null && costPerDay > 0 ? Math.floor(balance / costPerDay) : null; // balance is in money for BD gateways

  const cards = [
    { label: "আজকের এসএমএস", value: toBnDigits(today._count), hint: `${toBnDigits(today._sum.parts ?? 0)} পার্ট` },
    { label: "পাঠানো হয়েছে", value: toBnDigits(count("SENT")), tone: "text-sky-700" },
    { label: "পৌঁছেছে", value: toBnDigits(count("DELIVERED")), tone: "text-brand-700" },
    { label: "ব্যর্থ", value: toBnDigits(count("FAILED")), tone: count("FAILED") ? "text-red-700" : "" },
    { label: "অপেক্ষমাণ", value: toBnDigits(count("QUEUED") + count("SENDING")), hint: retrying ? `${toBnDigits(retrying)} টি পুনরায় চেষ্টা হবে` : undefined },
  ];

  return (
    <>
      <PageHeader title="এসএমএস" description="স্বয়ংক্রিয় ও হাতে পাঠানো এসএমএস, ডেলিভারি অবস্থা ও ব্যালেন্স" />
      <SmsTabs active="/sms" canManage={can(ctx, "sms:manage")} />
      {!settings?.enabled && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          এসএমএস বন্ধ আছে — কোনো স্বয়ংক্রিয় এসএমএস যাচ্ছে না।{" "}
          {can(ctx, "sms:manage") && <Link prefetch={false} href="/sms/settings" className="font-semibold underline">সেটিং থেকে চালু করুন</Link>}
        </div>
      )}
      <section className="panel mb-4">
        <div className="grid grid-cols-2 divide-x divide-y divide-rule sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0">
          {cards.map((c) => (
            <div key={c.label} className="figure">
              <span className="figure-label">{c.label}</span>
              <span className={`figure-value ${c.tone ?? ""}`}>{c.value}</span>
              {c.hint && <span className="text-[11px] text-slate-400">{c.hint}</span>}
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`panel ${lowBalance ? "ring-1 ring-red-300" : ""}`}>
          <div className="panel-head"><h2 className="panel-title">ব্যালেন্স ও আনুমানিক খরচ</h2></div>
          <dl className="space-y-2 p-4 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">প্রোভাইডার</dt><dd>{PROVIDER_LABELS[settings?.provider ?? "platform"] ?? settings?.provider}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">এসএমএস ব্যালেন্স</dt><dd className={`font-bold ${lowBalance ? "text-red-700" : ""}`}>{balance === null ? "—" : formatNumber(balance)}</dd></div>
            {settings?.balanceCheckedAt && <p className="text-[11px] text-slate-400">হালনাগাদ {formatDateTime(settings.balanceCheckedAt)}</p>}
            {lowBalance && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">ব্যালেন্স সতর্কতার সীমার ({formatNumber(num(settings!.lowBalanceThreshold))}) নিচে — রিচার্জ করুন</p>}
            <div className="flex justify-between border-t border-rule pt-2"><dt className="text-slate-500">এ মাসে পাঠানো</dt><dd>{toBnDigits(month._count)} টি · {toBnDigits(month._sum.parts ?? 0)} পার্ট</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">এ মাসের খরচ</dt><dd>{formatMoney(num(month._sum.cost), ctx.business.currencySymbol)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">গড় ব্যবহার</dt><dd>দিনে {formatNumber(perDay)} পার্ট</dd></div>
            {daysLeft !== null && <div className="flex justify-between"><dt className="text-slate-500">ব্যালেন্সে চলবে প্রায়</dt><dd>{toBnDigits(daysLeft)} দিন</dd></div>}
          </dl>
        </section>
        <section className="panel lg:col-span-2">
          <div className="panel-head">
            <h2 className="panel-title">সাম্প্রতিক এসএমএস</h2>
            <Link prefetch={false} href="/sms/log" className="text-xs font-medium text-brand-700 hover:underline">সব দেখুন</Link>
          </div>
          {recent.length === 0 ? <EmptyState message="এখনো কোনো এসএমএস নেই" /> : (
            <div className="overflow-x-auto">
              <table className="table">
                <tbody>
                  {recent.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-xs">{formatDateTime(m.createdAt)}</td>
                      <td>
                        <span className="block text-xs font-semibold">{SMS_EVENT[m.event]?.label ?? m.event}</span>
                        <span className="block text-xs text-slate-500">{m.customer?.name ?? m.supplier?.name ?? m.recipient}</span>
                      </td>
                      <td className="max-w-xs truncate text-xs text-slate-600" title={m.body}>{m.body}</td>
                      <td><SmsStatusBadge status={m.status} retrying={m.status === "QUEUED" && m.attempts > 0} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

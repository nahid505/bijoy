import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney, toBnDigits } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { sendManualSmsAction } from "@/server/actions/sms";
import { businessToday } from "@/server/services/notifications";
import { isBulk, MAX_BULK_RECIPIENTS, resolveRecipients, type SmsTarget } from "@/server/sms/manual";
import { SmsTabs } from "../sms-ui";
import { ComposeForm } from "./compose-form";
import { partyListWhere } from "@/server/party-scope";

export const metadata: Metadata = { title: "এসএমএস পাঠান" };

const SEGMENTS = [
  { key: "all", label: "সব সক্রিয় কাস্টমার" },
  { key: "due", label: "যাদের বাকি আছে" },
  { key: "overdue", label: "মেয়াদোত্তীর্ণ বকেয়া" },
] as const;

export default async function ComposePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("sms:send");
  const p = await readParams(searchParams);
  const target: SmsTarget | null = p.customers
    ? { kind: "customers", ids: p.customers.split(",").filter(Boolean).slice(0, MAX_BULK_RECIPIENTS + 1) }
    : p.group
      ? { kind: "group", group: p.group }
      : p.segment
        ? { kind: "segment", segment: (["all", "due", "overdue"].includes(p.segment) ? p.segment : "all") as "all" | "due" | "overdue" }
        : null;
  const canBulk = can(ctx, "sms:bulk");
  const [groups, settings, recipients] = await Promise.all([
    prisma.customer.groupBy({ by: ["groupName"], where: { businessId: ctx.business.id, ...partyListWhere(ctx, "CUSTOMER"), isActive: true, groupName: { not: null } }, _count: true, orderBy: { groupName: "asc" } }),
    prisma.smsSettings.findUnique({ where: { businessId: ctx.business.id }, select: { enabled: true } }),
    target ? resolveRecipients(prisma, ctx.business.id, target, businessToday(), ctx.partyScope.customers) : Promise.resolve([]),
  ]);
  const blockedBulk = target && isBulk(target) && !canBulk;
  const withMobile = new Set(recipients.filter((r) => r.mobile).map((r) => r.mobile)).size;
  const hidden: Record<string, string> = !target ? {} : target.kind === "customers" ? { targetKind: "customers", customerIds: target.ids.join(",") } : target.kind === "group" ? { targetKind: "group", group: target.group } : { targetKind: "segment", segment: target.segment };
  const cur = ctx.business.currencySymbol;

  return (
    <>
      <PageHeader title="এসএমএস পাঠান" description="একজন, নির্বাচিত বা গ্রুপের কাস্টমারকে বার্তা — প্রতিটি পাঠানো লগ ও অডিটে সংরক্ষিত" />
      <SmsTabs active="/sms/compose" canManage={can(ctx, "sms:manage")} />
      {!settings?.enabled && <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">এসএমএস বন্ধ আছে — পাঠানো যাবে না।</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">প্রাপক</h2></div>
          <div className="space-y-3 p-4 text-sm">
            <p className="text-xs text-slate-500">কাস্টমার তালিকা থেকে নির্বাচন করুন, অথবা:</p>
            {canBulk ? (
              <>
                <div className="flex flex-col gap-1">
                  {SEGMENTS.map((s) => (
                    <Link prefetch={false} key={s.key} href={`/sms/compose?segment=${s.key}`} className={`rounded px-2 py-1 hover:bg-ink-50 ${p.segment === s.key ? "bg-brand-50 font-semibold text-brand-800" : ""}`}>{s.label}</Link>
                  ))}
                </div>
                {groups.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-semibold text-slate-500">গ্রুপ</p>
                    <div className="flex flex-wrap gap-1">
                      {groups.map((g) => (
                        <Link prefetch={false} key={g.groupName} href={`/sms/compose?group=${encodeURIComponent(g.groupName!)}`} className={`rounded-full border border-rule px-2 py-0.5 text-xs hover:bg-ink-50 ${p.group === g.groupName ? "border-brand-500 bg-brand-50" : ""}`}>
                          {g.groupName} ({toBnDigits(g._count)})
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500">বাল্ক বা গ্রুপ এসএমএসের অনুমতি আপনার নেই — একজন কাস্টমারকে পাঠাতে কাস্টমার তালিকার “এসএমএস” বোতাম ব্যবহার করুন।</p>
            )}
            <Link prefetch={false} href="/customers" className="btn-secondary btn-sm">কাস্টমার তালিকা থেকে বাছাই</Link>
          </div>
        </section>
        <section className="panel lg:col-span-2">
          <div className="panel-head">
            <h2 className="panel-title">{target ? `${toBnDigits(recipients.length)} জন প্রাপক · ${toBnDigits(withMobile)} টি মোবাইল নম্বর` : "প্রাপক নির্বাচন করুন"}</h2>
          </div>
          {!target ? <EmptyState message="বাঁ পাশ থেকে প্রাপক নির্বাচন করুন" /> : blockedBulk ? (
            <p className="p-4 text-sm text-red-700">একাধিক কাস্টমার বা গ্রুপে এসএমএস পাঠানোর অনুমতি (sms:bulk) আপনার নেই।</p>
          ) : recipients.length === 0 ? <EmptyState message="কোনো প্রাপক পাওয়া যায়নি" /> : recipients.length > MAX_BULK_RECIPIENTS ? (
            <p className="p-4 text-sm text-red-700">একবারে সর্বোচ্চ {toBnDigits(MAX_BULK_RECIPIENTS)} জনকে পাঠানো যায়।</p>
          ) : (
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <div className="max-h-80 overflow-y-auto rounded border border-rule">
                <table className="table">
                  <tbody>
                    {recipients.map((r) => (
                      <tr key={r.customerId}>
                        <td className="text-xs">{r.name}<span className={`block font-mono ${r.mobile ? "text-slate-500" : "text-red-600"}`}>{r.mobile ?? "মোবাইল নেই"}</span></td>
                        <td className="num text-xs">{r.due > 0 ? formatMoney(r.due, cur) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {settings?.enabled && withMobile > 0 ? (
                <ComposeForm action={sendManualSmsAction} hidden={hidden} count={recipients.length} withMobile={withMobile} sample={{ customer_name: recipients[0].name, due: String(Math.max(0, recipients[0].due)), business_name: ctx.business.name }} />
              ) : (
                <p className="text-sm text-slate-500">{withMobile === 0 ? "কোনো প্রাপকের মোবাইল নম্বর নেই।" : "এসএমএস চালু করলে এখান থেকে পাঠানো যাবে।"}</p>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

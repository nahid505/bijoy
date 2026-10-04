import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma, SmsStatus } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { formatDateTime, toBnDigits } from "@/lib/format";
import { SMS_EVENTS, SMS_EVENT, SMS_STATUS_LABELS } from "@/lib/sms-text";
import { ActionButton } from "@/components/forms";
import { EmptyState, FilterBar, FilterField, PageHeader, Pagination } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { retrySmsAction } from "@/server/actions/sms";
import { SmsStatusBadge, SmsTabs } from "../sms-ui";

export const metadata: Metadata = { title: "এসএমএস লগ" };
const STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "FAILED"] as const;

export default async function SmsLogPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("sms:view");
  const p = await readParams(searchParams);
  const { page, skip, take } = pageOf(p);
  const q = p.q?.trim();
  const where: Prisma.SmsMessageWhereInput = {
    businessId: ctx.business.id, // isolation: only this business's messages
    ...(STATUSES.includes(p.status as SmsStatus) ? { status: p.status as SmsStatus } : {}),
    ...(p.event && SMS_EVENT[p.event] ? { event: p.event } : {}),
    ...(p.batch ? { batchId: p.batch } : {}),
    ...(q ? { OR: [{ recipient: { contains: q } }, { body: { contains: q, mode: "insensitive" } }, { voucherNo: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { supplier: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.smsMessage.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include: { customer: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } }, createdBy: { select: { name: true } } } }),
    prisma.smsMessage.count({ where }),
  ]);
  const canManage = can(ctx, "sms:manage");

  return (
    <>
      <PageHeader title="এসএমএস লগ" description="প্রতিটি এসএমএস: প্রাপক, বার্তা, অবস্থা, প্রোভাইডার, রিকোয়েস্ট আইডি, খরচ ও ত্রুটি" />
      <SmsTabs active="/sms/log" canManage={canManage} />
      <section className="panel">
        <FilterBar action="/sms/log">
          <FilterField label="খুঁজুন"><input name="q" defaultValue={q ?? ""} placeholder="মোবাইল, নাম, ইনভয়েস, বার্তা" className="input w-56" /></FilterField>
          <FilterField label="অবস্থা">
            <select name="status" defaultValue={p.status ?? ""} className="input w-36">
              <option value="">সব</option>
              {STATUSES.map((s) => <option key={s} value={s}>{SMS_STATUS_LABELS[s]}</option>)}
            </select>
          </FilterField>
          <FilterField label="ধরন">
            <select name="event" defaultValue={p.event ?? ""} className="input w-48">
              <option value="">সব</option>
              {SMS_EVENTS.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
          </FilterField>
        </FilterBar>
        {rows.length === 0 ? <EmptyState message="কোনো এসএমএস পাওয়া যায়নি" /> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>সময়</th><th>প্রাপক</th><th>ধরন</th><th className="min-w-[16rem]">বার্তা</th><th>অবস্থা</th><th>প্রোভাইডার / রিকোয়েস্ট</th><th className="num">পার্ট / খরচ</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const who = m.customer ? { href: `/customers/${m.customer.id}`, name: m.customer.name } : m.supplier ? { href: `/suppliers/${m.supplier.id}`, name: m.supplier.name } : null;
                  return (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-xs">
                        {formatDateTime(m.createdAt)}
                        {m.sentAt && <span className="block text-slate-400">পাঠানো {formatDateTime(m.sentAt)}</span>}
                        {m.deliveredAt && <span className="block text-brand-700">পৌঁছেছে {formatDateTime(m.deliveredAt)}</span>}
                      </td>
                      <td className="text-xs">
                        <span className="font-mono">{m.recipient}</span>
                        {who && <Link prefetch={false} href={who.href} className="block text-brand-700 hover:underline">{who.name}</Link>}
                        {m.voucherNo && (m.voucherId ? <Link prefetch={false} href={`/vouchers/v/${m.voucherId}`} className="block text-slate-500 hover:underline">{m.voucherNo}</Link> : <span className="block text-slate-500">{m.voucherNo}</span>)}
                      </td>
                      <td className="text-xs">{SMS_EVENT[m.event]?.label ?? m.event}{m.createdBy && <span className="block text-slate-400">{m.createdBy.name}</span>}</td>
                      <td className="text-xs text-slate-700">{m.body}<span className="block text-[10px] text-slate-400">{m.encoding === "UCS2" ? "ইউনিকোড" : "GSM"}</span></td>
                      <td>
                        <SmsStatusBadge status={m.status} retrying={m.status === "QUEUED" && m.attempts > 0} />
                        {m.attempts > 1 && <span className="block text-[11px] text-slate-500">চেষ্টা {toBnDigits(m.attempts)}/{toBnDigits(m.maxAttempts)}</span>}
                        {m.lastError && <span className="block max-w-[14rem] text-[11px] text-red-700">{m.lastError}</span>}
                      </td>
                      <td className="text-[11px] text-slate-500">{m.provider ?? "—"}<span className="block break-all font-mono">{m.requestId ?? ""}</span></td>
                      <td className="num text-xs">{toBnDigits(m.parts)}{m.cost !== null && <span className="block text-slate-500">৳{num(m.cost)}</span>}</td>
                      <td>{canManage && m.status === "FAILED" && <ActionButton action={retrySmsAction.bind(null, m.id)} label="আবার পাঠান" className="btn-secondary btn-sm" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath="/sms/log" params={p} page={page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}

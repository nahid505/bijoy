// Dashboard of an assigned-only user ("শুধু নির্ধারিত কাস্টমার / সরবরাহকারী"): no business-wide figures — only
// their own customers / suppliers (count, dues, today's trade) and their recent vouchers.
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { VOUCHER_TYPES } from "@/lib/accounting";
import { dayRange, formatDate, formatMoney, toBnDigits, toDateInput } from "@/lib/format";
import { EmptyState, TableWrap } from "@/components/ui";
import { can, type AppContext } from "@/server/auth";
import { voucherScopeWhere } from "@/server/party-scope";
import { balancesBefore } from "@/server/services/ledger";

type Kind = "CUSTOMER" | "SUPPLIER";
const CFG = {
  CUSTOMER: { title: "আমার কাস্টমার", base: "/customers", due: "মোট পাওনা (বাকি)", trade: "আজকের বিক্রয়", types: ["SALES"] as const, sign: 1, perm: "customers:view" as const },
  SUPPLIER: { title: "আমার সরবরাহকারী", base: "/suppliers", due: "মোট দেনা", trade: "আজকের ক্রয়", types: ["PURCHASE"] as const, sign: -1, perm: "suppliers:view" as const },
};

async function PartyBlock({ ctx, kind }: { ctx: AppContext; kind: Kind }) {
  const cfg = CFG[kind];
  const allowed = kind === "CUSTOMER" ? ctx.partyScope.customers : ctx.partyScope.suppliers;
  if (allowed === null || !can(ctx, cfg.perm)) return null;
  const cur = ctx.business.currencySymbol;
  const today = toDateInput();
  const select = { id: true, name: true, mobile: true, accountId: true } as const;
  const [parties, trade] = await Promise.all([
    kind === "CUSTOMER"
      ? prisma.customer.findMany({ where: { businessId: ctx.business.id, isDepotDealer: false, accountId: { in: allowed } }, select, orderBy: { name: "asc" } })
      : prisma.supplier.findMany({ where: { businessId: ctx.business.id, accountId: { in: allowed } }, select, orderBy: { name: "asc" } }),
    prisma.voucher.aggregate({ where: { businessId: ctx.business.id, book: "GENERAL", ...voucherScopeWhere(ctx), type: { in: [...cfg.types] }, partyAccountId: { in: allowed }, date: dayRange(today, today) }, _sum: { amount: true }, _count: true }),
  ]);
  const bal = await balancesBefore(ctx.business.id, undefined, parties.map((p) => p.accountId));
  const rows = parties.map((p) => ({ ...p, due: round2(cfg.sign * (bal.get(p.accountId) ?? 0)) })).sort((a, b) => b.due - a.due);
  const totalDue = round2(rows.reduce((s, r) => s + Math.max(r.due, 0), 0));
  return (
    <section className="panel" aria-label={cfg.title}>
      <div className="panel-head">
        <h2 className="panel-title">{cfg.title}</h2>
        <Link prefetch={false} href={cfg.base} className="text-xs font-medium text-brand-700 hover:underline">সব দেখুন →</Link>
      </div>
      <div className="grid grid-cols-3 divide-x divide-rule border-b border-rule">
        <div className="px-4 py-3"><p className="text-[11px] text-slate-500">নির্ধারিত</p><p className="text-lg font-bold tabular-nums">{toBnDigits(rows.length)} জন</p></div>
        <div className="px-4 py-3"><p className="text-[11px] text-slate-500">{cfg.due}</p><p className="text-lg font-bold tabular-nums text-credit">{formatMoney(totalDue, cur)}</p></div>
        <div className="px-4 py-3"><p className="text-[11px] text-slate-500">{cfg.trade}</p><p className="text-lg font-bold tabular-nums text-brand-700">{formatMoney(num(trade._sum.amount), cur)}</p><p className="text-[11px] text-slate-400">{toBnDigits(trade._count)} টি</p></div>
      </div>
      {rows.length === 0 ? <EmptyState message="আপনার জন্য এখনও কেউ নির্ধারিত হয়নি — অ্যাডমিনের সাথে যোগাযোগ করুন" /> : (
        <TableWrap>
          <table className="table">
            <thead><tr><th>নাম</th><th>মোবাইল</th><th className="num">{kind === "CUSTOMER" ? "পাওনা" : "দেনা"}</th></tr></thead>
            <tbody>
              {rows.slice(0, 10).map((r) => (
                <tr key={r.id}>
                  <td><Link prefetch={false} href={`${cfg.base}/${r.id}`} className="font-semibold text-brand-700 hover:underline">{r.name}</Link></td>
                  <td>{r.mobile ?? "—"}</td>
                  <td className={`num font-semibold ${r.due > 0 ? "text-credit" : ""}`}>{formatMoney(r.due, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </section>
  );
}

export async function AssignedDashboard({ ctx }: { ctx: AppContext }) {
  const cur = ctx.business.currencySymbol;
  const viewable = (["SALES", "SALES_RETURN", "PURCHASE", "PURCHASE_RETURN", "RECEIPT", "PAYMENT"] as const).filter((t) =>
    can(ctx, t.startsWith("SALES") ? "sales:view" : t.startsWith("PURCHASE") ? "purchases:view" : "vouchers:view"),
  );
  const recent = viewable.length
    ? await prisma.voucher.findMany({
        where: { businessId: ctx.business.id, book: "GENERAL", ...voucherScopeWhere(ctx), type: { in: [...viewable] } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 8,
        include: { partyAccount: { select: { name: true } } },
      })
    : [];
  return (
    <>
      <p className="mb-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800" id="assigned-note">
        আপনি শুধু আপনার জন্য নির্ধারিত কাস্টমার/সরবরাহকারীর তথ্য ও লেনদেন দেখতে পাবেন।
      </p>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <PartyBlock ctx={ctx} kind="CUSTOMER" />
        <PartyBlock ctx={ctx} kind="SUPPLIER" />
      </div>
      {viewable.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">আমার সাম্প্রতিক লেনদেন</h2></div>
          {recent.length === 0 ? <EmptyState message="এখনও কোনো লেনদেন নেই" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>তারিখ</th><th>ভাউচার</th><th>ধরন</th><th>পার্টি</th><th className="num">টাকা</th></tr></thead>
                <tbody>
                  {recent.map((v) => (
                    <tr key={v.id}>
                      <td className="whitespace-nowrap">{formatDate(v.date)}</td>
                      <td><Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-semibold text-brand-700 hover:underline">{v.voucherNo}</Link></td>
                      <td>{VOUCHER_TYPES[v.type].label}</td>
                      <td>{v.partyAccount?.name ?? "নগদ"}</td>
                      <td className="num">{formatMoney(num(v.amount), cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </section>
      )}
    </>
  );
}

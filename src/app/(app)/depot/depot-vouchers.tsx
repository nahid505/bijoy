// Depot-book vouchers (src/lib/book.ts): stock in from the company, market collection from dealers and
// payments to the company. They reuse the voucher forms but are saved in the DEPOT book, numbered SI- / MC- / DP-,
// and never appear in the general purchases, receipts, payments, cash book or day book.
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { VOUCHER_TYPES } from "@/lib/accounting";
import { DEPOT_ACCESS, isDepot } from "@/lib/depot";
import { formatDate, formatMoney, toBnDigits } from "@/lib/format";
import { EmptyState, FilterBar, FilterField, PageHeader, Pagination, StatCard, TableWrap } from "@/components/ui";
import { getT } from "@/server/i18n";
import { can, requireContext, type AppContext } from "@/server/auth";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { reportPeriod } from "@/server/period";
import { voucherScopeWhere } from "@/server/party-scope";
import { VoucherEditor } from "@/server/voucher-editor";
import { voucherAccess } from "@/server/voucher-permissions";
import { DepotOnlyNotice } from "./depot-ui";

export type DepotVoucherKind = "stock-in" | "collections" | "payments" | "stock-adjust";

export const DEPOT_VOUCHERS: Record<DepotVoucherKind, { type: "PURCHASE" | "RECEIPT" | "PAYMENT" | "STOCK_JOURNAL"; title: string; newTitle: string; description: string; party: string }> = {
  "stock-in": { type: "PURCHASE", title: "স্টক ইন (কোম্পানি থেকে প্রাপ্তি)", newTitle: "নতুন স্টক ইন", description: "কোম্পানি থেকে পণ্য গ্রহণ — ফ্রি পরিমাণ সহ; ডিপোর স্টক ও কোম্পানির দেনা (ডিপো হিসাবে)", party: "কোম্পানি" },
  collections: { type: "RECEIPT", title: "মার্কেট কালেকশন", newTitle: "নতুন মার্কেট কালেকশন", description: "ডিলারদের কাছ থেকে মার্কেট বাকি আদায় — ডিপোর ক্যাশে (ডিপো হিসাবে)", party: "ডিলার" },
  "stock-adjust": { type: "STOCK_JOURNAL", title: "স্টক সমন্বয় (ডিপো)", newTitle: "নতুন ডিপো স্টক সমন্বয়", description: "ডিপোর পণ্যের ঘাটতি / উদ্বৃত্ত / ক্ষতি সমন্বয় — মূল্য ডিপোর ইনভেন্টরি ও ডিপোর লাভ-ক্ষতিতে, সাধারণ ইনভেন্টরিতে নয়", party: "—" },
  payments: { type: "PAYMENT", title: "কোম্পানিকে পেমেন্ট", newTitle: "নতুন কোম্পানি পেমেন্ট", description: "স্টকের দাম বাবদ কোম্পানিকে পরিশোধ — ডিপোর ক্যাশ থেকে (ডিপো হিসাবে)", party: "কোম্পানি" },
};

/** The depot stock adjustment has its own key: no depot:stock_adjust → no page (also not via a general key). */
const kindAllowed = (ctx: AppContext, kind: DepotVoucherKind) => kind !== "stock-adjust" || can(ctx, DEPOT_ACCESS.stockAdjust);

export async function DepotVoucherNewPage({ kind, searchParams }: { kind: DepotVoucherKind; searchParams: SearchParams }) {
  const cfg = DEPOT_VOUCHERS[kind];
  const ctx = await requireContext();
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  if (!can(ctx, voucherAccess(cfg.type, "create", ctx.business.businessType, "DEPOT")) || !kindAllowed(ctx, kind)) redirect("/forbidden");
  const p = await readParams(searchParams);
  return (
    <>
      <PageHeader title={cfg.newTitle} description={cfg.description} crumbs={[{ label: "ডিপো ব্যবস্থাপনা" }, { label: cfg.title, href: `/depot/${kind}` }, { label: "নতুন" }]} />
      <VoucherEditor ctx={ctx} type={cfg.type} partyAccountId={p.party} book="DEPOT" cancelTo={`/depot/${kind}`} />
    </>
  );
}

export async function DepotVoucherListPage({ kind, searchParams }: { kind: DepotVoucherKind; searchParams: SearchParams }) {
  const cfg = DEPOT_VOUCHERS[kind];
  const ctx = await requireContext();
  if (!isDepot(ctx.business.businessType)) return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  if (!can(ctx, voucherAccess(cfg.type, "view", ctx.business.businessType, "DEPOT")) || !kindAllowed(ctx, kind)) redirect("/forbidden");
  const p = await readParams(searchParams);
  const { page, skip, take } = pageOf(p);
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  const types = cfg.type === "PURCHASE" ? (["PURCHASE", "PURCHASE_RETURN"] as const) : ([cfg.type] as const);
  const where: Prisma.VoucherWhereInput = { businessId: ctx.business.id, book: "DEPOT", type: { in: [...types] }, date: range, ...voucherScopeWhere(ctx) };
  const [rows, total, sum] = await Promise.all([
    prisma.voucher.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip, take, include: { partyAccount: { select: { name: true } }, cashAccount: { select: { name: true } } } }),
    prisma.voucher.count({ where }),
    prisma.voucher.aggregate({ where, _sum: { amount: true } }),
  ]);
  const canNew = can(ctx, voucherAccess(cfg.type, "create", ctx.business.businessType, "DEPOT")) && kindAllowed(ctx, kind);
  const t = await getT();
  return (
    <>
      <PageHeader
        title={cfg.title}
        description={`${cfg.description} — সাধারণ হিসাব থেকে সম্পূর্ণ আলাদা`}
        crumbs={[{ label: "ডিপো ব্যবস্থাপনা" }, { label: cfg.title }]}
        actions={canNew ? <Link prefetch={false} href={`/depot/${kind}/new`} className="btn-primary">+ {t(cfg.newTitle)}</Link> : undefined}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <StatCard label="এই সময়ে ভাউচার" value={toBnDigits(total)} />
        <StatCard label="মোট টাকা" value={formatMoney(num(sum._sum.amount), cur)} tone="green" />
      </div>
      <section className="panel">
        <FilterBar action={`/depot/${kind}`}>
          <FilterField label="শুরু"><input type="date" name="from" defaultValue={from} className="input w-40" /></FilterField>
          <FilterField label="শেষ"><input type="date" name="to" defaultValue={to} className="input w-40" /></FilterField>
        </FilterBar>
        {rows.length === 0 ? <EmptyState message="এই সময়ে কোনো এন্ট্রি নেই" /> : (
          <TableWrap>
            <table className="table" id="depot-vouchers">
              <thead><tr><th>{t("তারিখ")}</th><th>{t("ভাউচার")}</th><th>{t("ধরন")}</th><th>{t(cfg.party)}</th><th>{t("নগদ/ব্যাংক")}</th><th className="num">{t("টাকা")}</th></tr></thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id}>
                    <td className="whitespace-nowrap">{formatDate(v.date)}</td>
                    <td><Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-semibold text-brand-700 hover:underline">{v.voucherNo}</Link></td>
                    <td className="text-sm">{t(VOUCHER_TYPES[v.type].label)}</td>
                    <td>{v.partyAccount?.name ?? "—"}</td>
                    <td className="text-sm">{v.cashAccount?.name ?? "—"}</td>
                    <td className="num font-semibold">{formatMoney(num(v.amount), cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath={`/depot/${kind}`} params={p} page={page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}

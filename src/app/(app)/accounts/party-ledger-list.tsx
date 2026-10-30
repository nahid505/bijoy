import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney, toBnDigits, formatDate } from "@/lib/format";
import { digitVariants, toAsciiDigits } from "@/lib/digits";
import { round2 } from "@/lib/calc";
import { ci } from "@/lib/dialect";
import { isDepot } from "@/lib/depot";
import type { BookFilter } from "@/lib/book";
import { can, requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { reportPeriod } from "@/server/period";
import { partyListWhere } from "@/server/party-scope";
import { partySummaries } from "@/server/services/ledger";
import { REPORT_ACCESS } from "@/lib/permissions";
import { LedgerAvatar } from "@/components/ledger-avatar";
import { Badge, FilterField, PageHeader, PrintHeader } from "@/components/ui";
import { PrintButton } from "@/components/forms";
import type { SearchParams } from "@/server/params";

interface PartyLedgerListProps {
  kind: "CUSTOMER" | "SUPPLIER";
  searchParams: Record<string, string | undefined>;
  basePath: string;
  title: string;
  description: string;
  crumbs: { label: string; href?: string }[];
}

export async function PartyLedgerList({
  kind,
  searchParams,
  basePath,
  title,
  description,
  crumbs,
}: PartyLedgerListProps) {
  const ctx = await requirePermission(REPORT_ACCESS.ledgerView);
  const t = await getT();
  const cur = ctx.business.currencySymbol;
  const isCustomer = kind === "CUSTOMER";

  const p = searchParams;
  const q = p.q?.trim();
  const filterStatus = p.status ?? "all";
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);

  const scopeWhere = partyListWhere(ctx, kind);
  const isDep = isDepot(ctx.business.businessType);
  const bookFilter: BookFilter = isDep ? "ALL" : "GENERAL";

  const qFilter = q
    ? {
        OR: [
          ...digitVariants(q).map((v) => ({ name: ci(v) })),
          { mobile: { contains: toAsciiDigits(q) } },
          { account: { code: { contains: toAsciiDigits(q) } } },
          { address: ci(q) },
        ],
      }
    : {};

  const parties = isCustomer
    ? await prisma.customer.findMany({
        where: {
          businessId: ctx.business.id,
          ...scopeWhere,
          isDepotDealer: false,
          ...qFilter,
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          mobile: true,
          address: true,
          imageUrl: true,
          isActive: true,
          isDepotDealer: true,
          accountId: true,
          account: {
            select: {
              id: true,
              code: true,
              imageUrl: true,
            },
          },
        },
      })
    : await prisma.supplier.findMany({
        where: {
          businessId: ctx.business.id,
          ...scopeWhere,
          ...qFilter,
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          mobile: true,
          address: true,
          imageUrl: true,
          isActive: true,
          accountId: true,
          account: {
            select: {
              id: true,
              code: true,
              imageUrl: true,
            },
          },
        },
      });

  const sums = await partySummaries(
    ctx.business.id,
    kind,
    range,
    parties.map((x) => x.accountId),
    bookFilter
  );

  type PartyItem = (typeof parties)[number] & {
    isDepotDealer?: boolean;
    opening: number;
    debit: number;
    credit: number;
    closing: number;
    due: number;
  };

  const allRows: PartyItem[] = parties.map((party) => {
    const s = sums.get(party.accountId) ?? { opening: 0, debit: 0, credit: 0, closing: 0 };
    const due = isCustomer ? s.closing : -s.closing;

    return {
      ...party,
      isDepotDealer: isCustomer ? (party as any).isDepotDealer : false,
      opening: s.opening,
      debit: s.debit,
      credit: s.credit,
      closing: s.closing,
      due,
    };
  });

  // Sort by highest balance first (Descending: highest due to lowest amount)
  // Negative (advance) and zero balances stay at the bottom of the list
  allRows.sort((a, b) => {
    if (Math.abs(b.due - a.due) > 0.0001) {
      return b.due - a.due;
    }
    return a.name.localeCompare(b.name, "bn");
  });

  const filteredRows = allRows.filter((r) => {
    if (filterStatus === "due") {
      return r.due > 0.005;
    }
    return true;
  });

  let totalDebit = 0;
  let totalCredit = 0;
  let partiesWithDues = 0;
  let totalDueAmount = 0;

  for (const r of filteredRows) {
    totalDebit += r.debit;
    totalCredit += r.credit;
    if (r.due > 0.005) {
      partiesWithDues++;
      totalDueAmount += r.due;
    }
  }

  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);
  totalDueAmount = round2(totalDueAmount);

  const periodSubtitle = `${formatDate(from)} — ${formatDate(to)}`;
  const canCreate = isCustomer ? can(ctx, "customers:manage") : can(ctx, "suppliers:manage");

  return (
    <>
      <PrintHeader
        business={ctx.business}
        title={t(title)}
        subtitle={periodSubtitle}
      />

      <PageHeader
        title={t(title)}
        description={t(description)}
        crumbs={crumbs}
        actions={
          <div className="flex items-center gap-2">
            {canCreate && (
              <Link
                prefetch={false}
                href={isCustomer ? "/customers/new" : "/suppliers/new"}
                className="btn-primary flex items-center gap-1.5"
              >
                <span>{isCustomer ? "👤" : "🏭"}</span>
                <span>{isCustomer ? t("নতুন কাস্টমার") : t("নতুন সরবরাহকারী")}</span>
              </Link>
            )}
          </div>
        }
      />

      <section className="panel overflow-hidden border border-slate-200/80 shadow-xs">
        {/* Search & Filters */}
        <div className="border-b border-slate-100 bg-slate-50/60 p-4">
          <form
            action={basePath}
            method="get"
            className="no-print flex flex-wrap items-end gap-3"
          >
            <FilterField label={t("খুঁজুন")}>
              <input
                name="q"
                defaultValue={p.q}
                className="input w-56 sm:w-64"
                placeholder={isCustomer ? t("নাম, কোড, মোবাইল…") : t("নাম, কোড, মোবাইল…")}
              />
            </FilterField>
            <FilterField label={t("হতে")}>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="input w-36"
              />
            </FilterField>
            <FilterField label={t("পর্যন্ত")}>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="input w-36"
              />
            </FilterField>
            <FilterField label={t("ফিল্টার")}>
              <select
                name="status"
                defaultValue={filterStatus}
                className="input w-36"
              >
                <option value="all">{t("সকল")}</option>
                <option value="due">{isCustomer ? t("শুধু বকেয়া পাওনা") : t("শুধু দেনা")}</option>
              </select>
            </FilterField>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="btn-secondary min-h-[38px] px-4 font-semibold text-xs sm:text-sm"
              >
                <span>🔍</span>
                <span>{t("খুঁজুন")}</span>
              </button>
              <Link
                prefetch={false}
                href={basePath}
                className="btn-ghost min-h-[38px] px-3 text-xs sm:text-sm text-slate-500 hover:text-slate-700"
              >
                {t("রিসেট")}
              </Link>
              <PrintButton label={t("প্রিন্ট")} />
              <Link
                prefetch={false}
                href={`/api/reports/${isCustomer ? "customers" : "suppliers"}?${new URLSearchParams({
                  ...(p.from ? { from: p.from } : {}),
                  ...(p.to ? { to: p.to } : {}),
                  ...(p.q ? { q: p.q } : {}),
                }).toString()}`}
                className="btn-ghost min-h-[38px] px-2.5 text-xs font-semibold text-slate-600 hover:text-brand-700"
                title={t("সিএসভি ডাউনলোড")}
              >
                <span>📥</span>
                <span>CSV</span>
              </Link>
            </div>
          </form>
        </div>

        {/* List / Card Table View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-gray-200 bg-slate-50/80 text-xs sm:text-sm font-semibold text-gray-700 tracking-wider">
                <th className="py-4 px-4 sm:px-6 font-bold">{isCustomer ? t("কাস্টমার / হিসাব বিবরণী") : t("সরবরাহকারী / হিসাব বিবরণী")}</th>
                <th className="py-4 px-4 sm:px-6 text-right w-48 sm:w-64 font-bold">
                  <span>{isCustomer ? t("ব্যালেন্স / মোট পাওনা") : t("ব্যালেন্স / মোট দেনা")}</span>{" "}
                  <span className="text-xs font-normal text-slate-400">({cur})</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="py-12 text-center text-sm font-medium text-slate-500">
                    {isCustomer ? t("কোনো কাস্টমার পাওয়া যায়নি") : t("কোনো সরবরাহকারী পাওয়া যায়নি")}
                  </td>
                </tr>
              ) : (
                filteredRows.map((party) => {
                  const detailUrl = party.isDepotDealer
                    ? `/depot/dealers/${party.id}`
                    : `/${isCustomer ? "customers" : "suppliers"}/${party.id}`;

                  const isAdvance = isCustomer ? party.closing < -0.005 : party.closing > 0.005;
                  const absClosing = Math.abs(party.closing);

                  const balanceTone = isCustomer
                    ? party.closing > 0.005
                      ? "text-emerald-700"
                      : party.closing < -0.005
                        ? "text-rose-700"
                        : "text-slate-400"
                    : -party.closing > 0.005
                      ? "text-rose-700"
                      : party.closing > 0.005
                        ? "text-emerald-700"
                        : "text-slate-400";

                  return (
                    <tr key={party.id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-4 px-4 sm:px-6">
                        <div className="flex items-center gap-3.5 sm:gap-4">
                          <Link prefetch={false} href={detailUrl} className="shrink-0 transition-transform group-hover:scale-105">
                            <LedgerAvatar
                              name={party.name}
                              imageUrl={party.imageUrl ?? party.account?.imageUrl}
                              size="md"
                            />
                          </Link>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link
                                prefetch={false}
                                href={detailUrl}
                                className="font-bold text-gray-900 group-hover:text-brand-700 hover:underline transition-colors text-base sm:text-lg leading-snug"
                              >
                                {party.name}
                              </Link>
                              {!party.isActive && <Badge tone="slate">{t("নিষ্ক্রিয়")}</Badge>}
                              {party.isDepotDealer && <Badge tone="blue">{t("ডিলার")}</Badge>}
                            </div>
                            <div className="text-xs sm:text-sm text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                              {party.account?.code && (
                                <span className="font-mono text-slate-600 bg-slate-100 px-2 py-0.5 rounded text-xs font-bold">
                                  {party.account.code}
                                </span>
                              )}
                              {party.account?.code && party.mobile && <span className="text-slate-300">•</span>}
                              {party.mobile && (
                                <span className="font-mono text-slate-600 font-medium">{toBnDigits(party.mobile)}</span>
                              )}
                              {!party.mobile && !party.account?.code && (
                                <span>{isCustomer ? t("কাস্টমার / গ্রাহক") : t("সরবরাহকারী")}</span>
                              )}
                              {party.address && (
                                <span className="hidden sm:inline text-slate-400 text-xs sm:text-sm">
                                  • {party.address}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 sm:px-6 text-right align-middle w-48 sm:w-64">
                        <Link prefetch={false} href={detailUrl} className="block group-hover:opacity-90">
                          {absClosing > 0.005 ? (
                            <div>
                              <span className={`font-black text-lg sm:text-xl md:text-2xl tabular-nums ${balanceTone}`}>
                                {formatMoney(absClosing, cur)}
                              </span>
                              {isAdvance && (
                                <span className="block text-xs font-bold text-slate-500 mt-0.5">
                                  ({t("অগ্রিম")})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300 font-medium text-base">—</span>
                          )}
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Summary Bar */}
        <div className="border-t-2 border-slate-200 bg-slate-50/90 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-base sm:text-lg font-bold text-ink-900 flex items-center gap-2">
                <span>👥</span>
                <span>
                  {toBnDigits(filteredRows.length)} {isCustomer ? t("জন কাস্টমার") : t("জন সরবরাহকারী")}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                {isCustomer
                  ? t("{count} জন কাস্টমারের কাছে মোট বকেয়া পাওনা রয়েছে", { count: toBnDigits(partiesWithDues) })
                  : t("{count} জন সরবরাহকারীর কাছে মোট দেনা রয়েছে", { count: toBnDigits(partiesWithDues) })}
              </p>
            </div>

            <div className="flex items-center">
              <div
                className={`flex flex-col items-end rounded-2xl px-6 py-3.5 border shadow-xs ${
                  isCustomer
                    ? "bg-emerald-50/90 border-emerald-200 text-emerald-950"
                    : "bg-rose-50/90 border-rose-200 text-rose-950"
                }`}
              >
                <span className="text-xs sm:text-sm font-bold flex items-center gap-1.5">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isCustomer ? "bg-emerald-600 animate-pulse" : "bg-rose-600 animate-pulse"
                    }`}
                  />
                  <span>{isCustomer ? t("সর্বমোট পাওনা (দেনাদার)") : t("সর্বমোট দেনা (পাওনাদার)")}</span>
                </span>
                <span
                  className={`text-2xl sm:text-3xl font-black tabular-nums mt-0.5 ${
                    isCustomer ? "text-emerald-900" : "text-rose-900"
                  }`}
                >
                  {formatMoney(totalDueAmount, cur)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

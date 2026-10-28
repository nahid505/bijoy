import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canOpenLedger } from "@/server/party-scope";
import { prisma } from "@/lib/db";
import { NATURE_LABELS, VOUCHER_TYPES, type Nature, type VoucherTypeKey } from "@/lib/accounting";
import { formatDate, toDateInput } from "@/lib/format";
import { ActionButton } from "@/components/forms";
import { buildQuery, PrintHeader } from "@/components/ui";
import { LedgerStatement, type LedgerRow } from "@/components/ledger-statement";
import { can, requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { readParams, type SearchParams } from "@/server/params";
import { reportPeriod } from "@/server/period";
import { statement } from "@/server/services/ledger";
import { deleteAccountAction, toggleAccountAction } from "@/server/actions/masters";

export const metadata: Metadata = { title: "লেজার" };

/**
 * Ledger / খতিয়ান of one account for a period (?from=&to=, default this fiscal year): the opening balance, every
 * entry with its counter ledgers, voucher number, note and who entered it, and the running balance (Dr / Cr).
 * Search, the type filter and "বিস্তারিত" work in the browser (LedgerStatement); Excel / CSV use the ledger report.
 */
export default async function AccountLedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requirePermission("accounts:view");
  const { id } = await params;
  const a = await prisma.account.findFirst({ where: { id, businessId: ctx.business.id }, include: { group: true, customer: true, supplier: true } });
  if (!a) notFound();
  if (!(await canOpenLedger(ctx, a.id))) redirect("/forbidden"); // assigned-only roles: their parties' ledgers only
  const t = await getT();
  const p = await readParams(searchParams);
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const st = await statement(ctx.business.id, [a.id], range);

  const manage = can(ctx, "accounts:manage") && !a.customer && !a.supplier;
  const partyLink = a.customer ? `/customers/${a.customer.id}` : a.supplier ? `/suppliers/${a.supplier.id}` : null;
  const cashLike = a.kind === "CASH" || a.kind === "BANK";
  const typeLabel = (k: string) => VOUCHER_TYPES[k as VoucherTypeKey]?.label ?? k;

  const rows: LedgerRow[] = [
    // the balance brought forward from before the period
    { id: "opening", date: formatDate(from), voucherId: null, voucherNo: null, type: "OPENING", typeLabel: typeLabel("OPENING"), against: "", narration: null, enteredBy: null, debit: 0, credit: 0, balance: st.opening },
    ...st.lines.map((l) => ({
      id: l.entryId,
      date: formatDate(l.date),
      voucherId: l.voucherId,
      voucherNo: l.voucherNo,
      type: l.voucherType as LedgerRow["type"],
      typeLabel: typeLabel(l.voucherType),
      against: l.against,
      narration: l.narration,
      enteredBy: l.enteredBy,
      debit: l.debit,
      credit: l.credit,
      balance: l.balance,
    })),
  ];
  const subtitle = [a.group.name, NATURE_LABELS[a.nature as Nature], a.code ? `${t("কোড")} ${a.code}` : null, a.isActive ? null : t("নিষ্ক্রিয়")].filter(Boolean).map((x) => t(x as string)).join(" · ");
  const party = a.customer ?? a.supplier;

  return (
    <>
      <LedgerStatement
        name={a.name}
        subtitle={subtitle}
        backHref={partyLink ?? "/accounts"}
        rows={rows}
        opening={st.opening}
        closing={st.closing}
        currency={ctx.business.currencySymbol}
        from={from}
        to={to}
        fromText={formatDate(from)}
        toText={formatDate(to)}
        booksFrom={toDateInput(ctx.business.booksStartDate)}
        exportHref={`/api/reports/ledger${buildQuery({ accountId: a.id, from, to })}`}
        canExport={can(ctx, "reports:view")}
        printHeader={
          <>
            <PrintHeader business={ctx.business} title={`${t("লেজার / খতিয়ান")}: ${a.name}`} subtitle={`${formatDate(from)} — ${formatDate(to)}`} />
            {party && (party.mobile || party.address) && <p className="print-only mb-2 text-xs">{[party.mobile, party.address].filter(Boolean).join(" · ")}</p>}
          </>
        }
      />
      <div className="no-print mt-4 flex flex-wrap gap-2">
        {partyLink && <Link prefetch={false} href={partyLink} className="btn-secondary">{t(a.customer ? "কাস্টমার প্রোফাইল" : "সরবরাহকারী প্রোফাইল")}</Link>}
        {!cashLike && can(ctx, "vouchers:create") && <Link prefetch={false} href={`/vouchers/receipt/new?party=${a.id}`} className="btn-secondary">{t("রিসিপ্ট")}</Link>}
        {!cashLike && can(ctx, "vouchers:create") && <Link prefetch={false} href={`/vouchers/payment/new?party=${a.id}`} className="btn-secondary">{t("পেমেন্ট")}</Link>}
        {manage && <Link prefetch={false} href={`/accounts/${a.id}/edit`} className="btn-secondary">{t("সম্পাদনা")}</Link>}
        {manage && !a.isSystem && <ActionButton action={toggleAccountAction.bind(null, a.id, !a.isActive)} label={a.isActive ? "নিষ্ক্রিয়" : "সক্রিয়"} className="btn-secondary" />}
        {manage && !a.isSystem && <ActionButton action={deleteAccountAction.bind(null, a.id)} label="মুছুন" className="btn-danger" confirmText="হিসাবটি মুছে ফেলতে চান?" />}
      </div>
    </>
  );
}

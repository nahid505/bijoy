import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { canOpenLedger } from "@/server/party-scope";
import { prisma } from "@/lib/db";
import { NATURE_LABELS, type Nature } from "@/lib/accounting";
import { ActionButton } from "@/components/forms";
import { ReportPage } from "@/components/report-page";
import { can, requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { deleteAccountAction, toggleAccountAction } from "@/server/actions/masters";

export const metadata: Metadata = { title: "লেজার" };

export default async function AccountLedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requirePermission("accounts:view");
  const { id } = await params;
  const a = await prisma.account.findFirst({ where: { id, businessId: ctx.business.id }, include: { group: true, customer: true, supplier: true } });
  if (!a) notFound();
  if (!(await canOpenLedger(ctx, a.id))) redirect("/forbidden"); // assigned-only roles: their parties' ledgers only
  const p = { ...(await readParams(searchParams)), accountId: a.id };
  const manage = can(ctx, "accounts:manage") && !a.customer && !a.supplier;
  const partyLink = a.customer ? `/customers/${a.customer.id}` : a.supplier ? `/suppliers/${a.supplier.id}` : null;
  const cashLike = a.kind === "CASH" || a.kind === "BANK";

  return (
    <ReportPage
      slug="ledger"
      params={p}
      basePath={`/accounts/${a.id}`}
      omitFilters={["account"]}
      title={`লেজার: ${a.name}`}
      description={`${a.group.name} · ${NATURE_LABELS[a.nature as Nature]}${a.code ? ` · কোড ${a.code}` : ""}${a.isActive ? "" : " · নিষ্ক্রিয়"}`}
      crumbs={[{ label: "হিসাব" }, { label: "লেজার", href: "/accounts" }, { label: a.name }]}
      extraActions={
        <>
          {partyLink && <Link prefetch={false} href={partyLink} className="btn-secondary">{a.customer ? "কাস্টমার প্রোফাইল" : "সরবরাহকারী প্রোফাইল"}</Link>}
          {!cashLike && can(ctx, "vouchers:create") && <Link prefetch={false} href={`/vouchers/receipt/new?party=${a.id}`} className="btn-secondary">রিসিপ্ট</Link>}
          {!cashLike && can(ctx, "vouchers:create") && <Link prefetch={false} href={`/vouchers/payment/new?party=${a.id}`} className="btn-secondary">পেমেন্ট</Link>}
          {manage && <Link prefetch={false} href={`/accounts/${a.id}/edit`} className="btn-secondary">সম্পাদনা</Link>}
          {manage && !a.isSystem && <ActionButton action={toggleAccountAction.bind(null, a.id, !a.isActive)} label={a.isActive ? "নিষ্ক্রিয়" : "সক্রিয়"} className="btn-secondary" />}
          {manage && !a.isSystem && <ActionButton action={deleteAccountAction.bind(null, a.id)} label="মুছুন" className="btn-danger" confirmText="হিসাবটি মুছে ফেলতে চান?" />}
        </>
      }
    />
  );
}

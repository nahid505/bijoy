import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { VOUCHER_TYPES, voucherTypeFromSlug } from "@/lib/accounting";
import { PageHeader } from "@/components/ui";
import { can, requireContext } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { VoucherEditor } from "@/server/voucher-editor";
import { voucherAccess, voucherPermission } from "@/server/voucher-permissions";
import { isDepot } from "@/lib/depot";

export const metadata: Metadata = { title: "নতুন ভাউচার" };

const DEPOT_NEW: Partial<Record<string, string>> = { PURCHASE: "/depot/stock-in/new", RECEIPT: "/depot/collections/new", PAYMENT: "/depot/payments/new" };

const HELP: Record<string, string> = {
  RECEIPT: "নগদ/ব্যাংকে টাকা আসা — কাস্টমার থেকে আদায়, আয়, মূলধন বা ঋণ গ্রহণ",
  PAYMENT: "নগদ/ব্যাংক থেকে টাকা যাওয়া — সরবরাহকারীকে পরিশোধ, খরচ, উত্তোলন",
  JOURNAL: "নগদ ছাড়া সমন্বয় এন্ট্রি — মোট ডেবিট ও মোট ক্রেডিট অবশ্যই সমান হতে হবে",
  SALES: "পণ্য বিক্রয় — স্টক কমবে, কাস্টমারের হিসাব, বিক্রয় ও বিক্রিত পণ্যের ব্যয় হিসাবে এন্ট্রি হবে",
  PURCHASE: "পণ্য ক্রয় — স্টক ও গড় ক্রয়মূল্য হালনাগাদ হবে, সরবরাহকারীর হিসাবে এন্ট্রি হবে",
  SALES_RETURN: "কাস্টমারের ফেরত দেওয়া পণ্য — স্টক বাড়বে, কাস্টমারের পাওনা কমবে",
  PURCHASE_RETURN: "সরবরাহকারীকে ফেরত দেওয়া পণ্য — স্টক কমবে, সরবরাহকারীর দেনা কমবে",
  STOCK_JOURNAL: "স্টক ঘাটতি/উদ্বৃত্ত সমন্বয় বা গুদাম স্থানান্তর",
};

export default async function NewVoucherPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: SearchParams }) {
  const { type: slug } = await params;
  const type = voucherTypeFromSlug(slug);
  if (!type) notFound();
  const ctx = await requireContext();
  // general vouchers only — depot stock in / collection / company payment have their own depot pages (depot book)
  if (!can(ctx, voucherPermission(type, "create"))) {
    const depotPage = DEPOT_NEW[type];
    if (depotPage && isDepot(ctx.business.businessType) && can(ctx, voucherAccess(type, "create", ctx.business.businessType, "DEPOT"))) redirect(depotPage);
    redirect("/forbidden");
  }
  const p = await readParams(searchParams);
  const meta = VOUCHER_TYPES[type];
  return (
    <>
      <PageHeader title={p.mode === "expense" ? "নতুন খরচ" : `নতুন ${meta.long}`} description={p.mode === "expense" ? "দোকান ভাড়া, বেতন, বিল ইত্যাদি খরচ — নগদ/ব্যাংক থেকে প্রদান" : HELP[type]} crumbs={[{ label: "লেনদেন" }, { label: meta.label, href: `/vouchers/${slug}` }, { label: "নতুন" }]} />
      <VoucherEditor ctx={ctx} type={type} partyAccountId={p.party} fromInvoiceId={p.from} mode={p.mode} />
    </>
  );
}

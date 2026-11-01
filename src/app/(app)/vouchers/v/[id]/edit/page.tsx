import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isPayrollVoucher } from "@/server/services/voucher";
import { prisma } from "@/lib/db";
import { VOUCHER_TYPES } from "@/lib/accounting";
import { PageHeader } from "@/components/ui";
import { can, requireContext, requirePermission } from "@/server/auth";
import { VoucherEditor } from "@/server/voucher-editor";
import { voucherPermission } from "@/server/voucher-permissions";
import { canSeeVoucher } from "@/server/party-scope";

export const metadata: Metadata = { title: "ভাউচার সম্পাদনা" };

export default async function EditVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id === "new") redirect("/depot/deliveries/new");
  const base = await requireContext();
  let v = await prisma.voucher.findFirst({
    where: { id, businessId: base.business.id },
    select: { id: true, type: true, voucherNo: true, sourceKey: true, verificationStatus: true, paddyPurchase: { select: { id: true } }, depotDelivery: { select: { id: true } } },
  });
  if (!v) {
    const d = await prisma.depotDelivery.findFirst({ where: { businessId: base.business.id, id }, select: { voucherId: true } });
    if (d?.voucherId) {
      redirect(`/depot/deliveries/${d.voucherId}/edit`);
    }
    redirect("/depot/deliveries");
  }
  if (v.type === "OPENING") redirect("/depot/deliveries");
  if (isPayrollVoucher(v.sourceKey)) redirect(`/vouchers/v/${v.id}`); // changed from the payroll module only
  if (v.verificationStatus && v.verificationStatus !== "UNVERIFIED" && !can(base, "vouchers:verify")) {
    redirect(`/vouchers/v/${v.id}`);
  }
  if (v.type === "PRODUCTION") redirect(`/production/${v.id}/edit`);
  if (v.paddyPurchase) redirect(`/purchases/paddy/${v.id}/edit`); // weighbridge slip: edited with its own form
  if (v.depotDelivery || v.type === "DEPOT_DELIVERY") redirect(`/depot/deliveries/${v.id}/edit`); // depot challan: its own form
  const ctx = await requirePermission(voucherPermission(v.type, "edit"));
  if (!(await canSeeVoucher(ctx, v.id))) redirect("/forbidden");
  const meta = VOUCHER_TYPES[v.type];
  return (
    <>
      <PageHeader
        title={`সম্পাদনা: ${meta.long} ${v.voucherNo}`}
        description="সংরক্ষণ করলে পুরনো এন্ট্রি ও স্টক বাতিল হয়ে নতুনভাবে পোস্ট হবে (একই ভাউচার নম্বর থাকবে)"
        crumbs={[{ label: meta.label, href: `/vouchers/${meta.slug}` }, { label: v.voucherNo, href: `/vouchers/v/${v.id}` }, { label: "সম্পাদনা" }]}
      />
      <VoucherEditor ctx={ctx} type={v.type as Exclude<typeof v.type, "PRODUCTION" | "OPENING">} voucherId={v.id} />
    </>
  );
}

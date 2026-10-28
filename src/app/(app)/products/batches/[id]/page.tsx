import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { expiryStatus, normalizeThresholds } from "@/lib/expiry";
import { formatDate, formatMoney, formatQty, toDateInput } from "@/lib/format";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { ExpiryBadge } from "@/components/expiry-badge";
import { DetailRow, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { updateBatchAction } from "@/server/actions/expiry";
import { businessToday } from "@/server/services/notifications";

export const metadata: Metadata = { title: "ব্যাচ সংশোধন" };

export default async function BatchEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("inventory:manage");
  const b = await prisma.productBatch.findFirst({
    where: { id, businessId: ctx.business.id },
    include: { product: { select: { id: true, name: true, unit: { select: { name: true } } } }, supplier: { select: { name: true } } },
  });
  if (!b) notFound();
  const status = expiryStatus(b.expiryDate, businessToday(), normalizeThresholds(ctx.business.expiryWarningDays));
  const cur = ctx.business.currencySymbol;
  return (
    <>
      <PageHeader
        title={`ব্যাচ ${b.batchNo}`}
        description={b.product.name}
        crumbs={[{ label: "পণ্য", href: "/products" }, { label: "ব্যাচ ও মেয়াদ", href: "/products/batches" }, { label: b.batchNo }]}
        actions={<Link prefetch={false} href={`/products/${b.product.id}`} className="btn-secondary">পণ্যের স্টক কার্ড</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">ব্যাচের তথ্য</h2><ExpiryBadge status={status} /></div>
          <dl className="divide-y divide-rule px-4 py-1">
            <DetailRow label="পণ্য">{b.product.name}</DetailRow>
            <DetailRow label="মজুদ">{formatQty(num(b.quantity))} {b.product.unit.name}</DetailRow>
            <DetailRow label="ক্রয়ের তারিখ">{formatDate(b.purchaseDate)}</DetailRow>
            <DetailRow label="সরবরাহকারী">{b.supplier?.name ?? "—"}</DetailRow>
            <DetailRow label="ক্রয়মূল্য (একক)">{formatMoney(num(b.purchasePrice), cur)}</DetailRow>
          </dl>
        </section>
        <section className="panel lg:col-span-2">
          <div className="panel-head"><h2 className="panel-title">সংশোধন</h2></div>
          <div className="p-4">
            <ActionForm action={updateBatchAction.bind(null, b.id)} className="grid gap-4 sm:grid-cols-3">
              <Field label="উৎপাদনের তারিখ" name="mfgDate"><input id="mfgDate" name="mfgDate" type="date" defaultValue={b.mfgDate ? toDateInput(b.mfgDate) : ""} className="input" /></Field>
              <Field label="মেয়াদ শেষের তারিখ" name="expiryDate"><input id="expiryDate" name="expiryDate" type="date" defaultValue={b.expiryDate ? toDateInput(b.expiryDate) : ""} className="input" /></Field>
              <Field label="বিক্রয়মূল্য" name="salePrice"><input id="salePrice" name="salePrice" type="text" inputMode="decimal" data-numeric min="0" step="0.01" defaultValue={num(b.salePrice)} className="input-num" /></Field>
              <p className="text-xs text-slate-500 sm:col-span-3">পরিবর্তন অডিট লগে সংরক্ষিত হয় এবং মেয়াদের নোটিফিকেশন সাথে সাথে পুনরায় যাচাই হয়।</p>
              <div className="sm:col-span-3"><SubmitButton>সংরক্ষণ করুন</SubmitButton></div>
            </ActionForm>
          </div>
        </section>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrintButton } from "@/components/forms";
import { SaasInvoice, toInvoiceView } from "@/components/saas-invoice";
import { requirePermission } from "@/server/auth";

export const metadata: Metadata = { title: "ইনভয়েস" };

export default async function SaasInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePermission("billing:view");
  // tenant isolation: only this business's invoices
  const inv = await prisma.invoice.findFirst({ where: { id, businessId: ctx.business.id }, include: { plan: { select: { nameBn: true } } } });
  if (!inv) notFound();
  return (
    <>
      <div className="no-print mb-4 flex gap-2">
        <PrintButton label="প্রিন্ট / PDF" />
        <Link prefetch={false} href="/billing" className="btn-secondary">← সাবস্ক্রিপশন</Link>
      </div>
      <SaasInvoice inv={toInvoiceView(inv)} />
    </>
  );
}

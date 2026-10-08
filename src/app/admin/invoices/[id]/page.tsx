import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrintButton } from "@/components/forms";
import { SaasInvoice, toInvoiceView } from "@/components/saas-invoice";

export const metadata: Metadata = { title: "ইনভয়েস — সুপার অ্যাডমিন" };

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inv = await prisma.invoice.findUnique({ where: { id }, include: { plan: { select: { nameBn: true } } } });
  if (!inv) notFound();
  return (
    <>
      <div className="no-print mb-4 flex gap-2">
        <PrintButton label="প্রিন্ট / PDF" />
        <Link prefetch={false} href={`/admin/companies/${inv.businessId}`} className="btn-secondary">← কোম্পানি</Link>
      </div>
      <SaasInvoice inv={toInvoiceView(inv)} />
    </>
  );
}

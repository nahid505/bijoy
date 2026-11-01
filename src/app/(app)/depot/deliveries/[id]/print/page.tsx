// Dealer copy of a depot delivery challan (A4 or 80 mm POS slip). Every line shows its rate — the saved
// challan rate (the product's purchase price at delivery; a market sale's own sale rate) — and
// amount = supplied quantity × rate; free goods are never priced. Never the depot's internal figures
// (commission). On a DO release the dealer paid the company, so there is no collection / due.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma, num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { DEPOT_ACCESS, isDepot } from "@/lib/depot";
import { formatDate } from "@/lib/format";
import { can, requirePermission } from "@/server/auth";
import { readParams, type SearchParams } from "@/server/params";
import { challanLineRate, loadDepotDelivery } from "@/server/services/depot";
import { DepotOnlyNotice } from "../../../depot-ui";
import { canSeeVoucher } from "@/server/party-scope";
import { DealerChallanView } from "./dealer-challan-view";

export const metadata: Metadata = { title: "ডেলিভারি চালান — ডিলার কপি" };

export default async function DealerChallanPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  if (!id || id === "new") redirect("/depot/deliveries/new");
  const ctx = await requirePermission(["depot_delivery_view", ...DEPOT_ACCESS.view]);
  if (!isDepot(ctx.business.businessType)) {
    return <DepotOnlyNotice canManage={can(ctx, "business:manage")} />;
  }
  const d = await loadDepotDelivery(ctx.business.id, id);
  if (!d) redirect("/depot/deliveries");
  if (!(await canSeeVoucher(ctx, d.voucherId))) redirect("/depot/deliveries"); // assigned-only roles: their parties only

  const pos = (await readParams(searchParams)).format === "pos";
  const b = ctx.business;
  const v = d.voucher;
  const doRelease = d.mode === "COMPANY_PAID";

  // Business owner (membership with system/owner role)
  const ownerMembership = await prisma.membership.findFirst({
    where: { businessId: b.id, role: { isSystem: true } },
    include: { user: { select: { name: true, mobile: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  const lines = v.items.map((i) => {
    const supplied = num(i.quantity);
    const free = num(i.freeQuantity);
    const rate = challanLineRate(d.mode, i);
    return {
      id: i.id,
      name: i.product.name,
      code: i.product.code ?? "",
      unit: i.product.unit.name,
      supplied,
      free,
      total: round3(supplied + free),
      rate,
      amount: round2(supplied * rate),
    };
  });

  const dealerAcc = d.dealerAccount;
  const companyAcc = d.companyAccount;

  return (
    <DealerChallanView
      business={{
        id: b.id,
        name: b.name,
        ownerName: ownerMembership?.user?.name ?? null,
        mobile: b.mobile || ownerMembership?.user?.mobile || null,
        address: b.address ?? null,
        email: b.email || ownerMembership?.user?.email || null,
        logo: b.logo ?? null,
        currencySymbol: b.currencySymbol,
      }}
      dealer={
        dealerAcc
          ? {
              name: dealerAcc.customer?.name || dealerAcc.name,
              ownerName: dealerAcc.customer?.ownerName ?? null,
              mobile: dealerAcc.customer?.mobile ?? null,
              address: dealerAcc.customer?.address ?? null,
              route: dealerAcc.customer?.route ?? null,
            }
          : null
      }
      company={
        companyAcc
          ? {
              name: companyAcc.supplier?.name || companyAcc.name,
              contactPerson: companyAcc.supplier?.notes || companyAcc.description || null,
              mobile: companyAcc.supplier?.mobile ?? null,
              address: companyAcc.supplier?.address ?? null,
              email: companyAcc.supplier?.email ?? null,
            }
          : null
      }
      delivery={{
        id: d.id,
        mode: d.mode,
        doNumber: d.doNumber ?? null,
        vehicleNo: d.vehicleNo ?? null,
        driverName: d.driverName ?? null,
        notes: d.notes ?? null,
      }}
      voucher={{
        id: v.id,
        voucherNo: v.voucherNo,
        dateFormatted: formatDate(v.date),
        paidAmount: doRelease ? 0 : num(v.paidAmount),
      }}
      lines={lines}
      pos={pos}
    />
  );
}

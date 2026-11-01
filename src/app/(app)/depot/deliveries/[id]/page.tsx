import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireContext } from "@/server/auth";

export default async function DepotDeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id === "new") redirect("/depot/deliveries/new");
  const ctx = await requireContext();
  const d = await prisma.depotDelivery.findFirst({
    where: {
      businessId: ctx.business.id,
      OR: [{ voucherId: id }, { id }],
    },
    select: { voucherId: true },
  });
  if (d?.voucherId) {
    redirect(`/vouchers/v/${d.voucherId}`);
  }
  // Safe fallback to deliveries list instead of blank 404
  redirect("/depot/deliveries");
}

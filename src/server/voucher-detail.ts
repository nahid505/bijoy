import "server-only";
import { prisma } from "@/lib/db";

export async function loadVoucher(businessId: string, id: string) {
  return prisma.voucher.findFirst({
    where: { id, businessId },
    include: {
      partyAccount: { include: { customer: true, supplier: true } },
      cashAccount: { select: { name: true } },
      warehouse: { select: { name: true } },
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
      entries: { orderBy: { lineNo: "asc" }, include: { account: { select: { id: true, name: true, group: { select: { name: true } } } } } },
      items: {
        orderBy: { lineNo: "asc" },
        include: {
          product: { select: { name: true, code: true } },
          unit: { select: { name: true } },
          warehouse: { select: { name: true } },
          stockMovements: { where: { batchId: { not: null } }, orderBy: { createdAt: "asc" }, select: { quantityIn: true, quantityOut: true, batch: { select: { batchNo: true, expiryDate: true } } } },
        },
      },
      payments: { orderBy: { lineNo: "asc" }, include: { account: { select: { name: true } } } },
      returnOf: { select: { id: true, voucherNo: true } },
      returns: { select: { id: true, voucherNo: true, amount: true, date: true }, orderBy: { date: "asc" } },
    },
  });
}

export type LoadedVoucher = NonNullable<Awaited<ReturnType<typeof loadVoucher>>>;

/** "B1 · মেয়াদ 10 Oct 2026" — or, for a FEFO line split over batches, "B1 ×20, B2 ×5". */
export function batchesOfItem(item: LoadedVoucher["items"][number], fmtDate: (d: Date) => string, fmtQty: (n: number) => string): string {
  const used = item.stockMovements.filter((m) => m.batch);
  if (used.length === 0) return item.batchNo ?? "";
  if (used.length === 1) return `${used[0].batch!.batchNo}${used[0].batch!.expiryDate ? ` · মেয়াদ ${fmtDate(used[0].batch!.expiryDate)}` : ""}`;
  return used.map((m) => `${m.batch!.batchNo} ×${fmtQty(Number(m.quantityIn) || Number(m.quantityOut))}${m.batch!.expiryDate ? ` (${fmtDate(m.batch!.expiryDate)})` : ""}`).join(", ");
}

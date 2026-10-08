// Batch-level expiry queries shared by the inventory batch list, dashboard and reports.
import { prisma } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { toBnDigits } from "@/lib/format";
import { expiryStatus, matchesFilter, normalizeThresholds, type ExpiryFilter, type ExpiryStatus } from "@/lib/expiry";
import { ci } from "@/lib/dialect";

export type BatchSort = "expiry" | "product" | "quantity" | "batch";

export interface BatchRow {
  id: string;
  productId: string;
  productName: string;
  productCode: string | null;
  unit: string;
  batchNo: string;
  mfgDate: Date | null;
  expiryDate: Date | null;
  purchaseDate: Date | null;
  supplierName: string | null;
  quantity: number;
  costPrice: number; // batch purchase cost per base unit (falls back to the product's average cost)
  salePrice: number;
  value: number; // quantity × cost price
  status: ExpiryStatus;
}

export interface BatchQuery {
  filter?: ExpiryFilter;
  within?: number | null; // only batches expiring within N days (not yet expired)
  q?: string;
  productId?: string;
  includeEmpty?: boolean; // include batches with no stock left
  sort?: BatchSort;
  dir?: "asc" | "desc";
}

export async function businessThresholds(businessId: string) {
  const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { expiryWarningDays: true, allowExpiredSale: true } });
  return { thresholds: normalizeThresholds(b.expiryWarningDays), allowExpiredSale: b.allowExpiredSale };
}

export async function listBatches(businessId: string, today: Date, query: BatchQuery = {}): Promise<BatchRow[]> {
  const { thresholds } = await businessThresholds(businessId);
  const q = query.q?.trim();
  const rows = await prisma.productBatch.findMany({
    where: {
      businessId,
      ...(query.includeEmpty ? {} : { quantity: { gt: 0 } }),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(q
        ? { OR: [{ batchNo: ci(q) }, { product: { name: ci(q) } }, { product: { code: ci(q) } }] }
        : {}),
    },
    include: { product: { select: { name: true, code: true, avgCost: true, unit: { select: { name: true } } } }, supplier: { select: { name: true } } },
  });
  const out = rows
    .map((b) => {
      const quantity = round3(Number(b.quantity));
      const costPrice = Number(b.purchasePrice) > 0 ? Number(b.purchasePrice) : Number(b.product.avgCost);
      return {
        id: b.id,
        productId: b.productId,
        productName: b.product.name,
        productCode: b.product.code,
        unit: b.product.unit.name,
        batchNo: b.batchNo,
        mfgDate: b.mfgDate,
        expiryDate: b.expiryDate,
        purchaseDate: b.purchaseDate,
        supplierName: b.supplier?.name ?? null,
        quantity,
        costPrice,
        salePrice: Number(b.salePrice),
        value: round2(quantity * costPrice),
        status: expiryStatus(b.expiryDate, today, thresholds),
      };
    })
    .filter((r) => matchesFilter(r.status, query.filter ?? "all", query.within));

  const dir = query.dir === "desc" ? -1 : 1;
  const exp = (r: BatchRow) => r.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const cmp: Record<BatchSort, (a: BatchRow, b: BatchRow) => number> = {
    expiry: (a, b) => exp(a) - exp(b),
    product: (a, b) => a.productName.localeCompare(b.productName, "bn"),
    quantity: (a, b) => a.quantity - b.quantity,
    batch: (a, b) => a.batchNo.localeCompare(b.batchNo),
  };
  const by = cmp[query.sort ?? "expiry"];
  return out.sort((a, b) => dir * by(a, b) || exp(a) - exp(b) || a.batchNo.localeCompare(b.batchNo));
}

export interface ExpiryCard {
  key: string;
  label: string;
  href: string;
  batches: number;
  quantity: number;
  value: number;
  tone: "red" | "amber" | "green";
}

/** Dashboard summary: expired + the three nearest warning bands (default 7 / 15 / 30 days). */
export async function expirySummary(businessId: string, today: Date) {
  const { thresholds } = await businessThresholds(businessId);
  const rows = await listBatches(businessId, today);
  const bands = [...thresholds].sort((a, b) => a - b).slice(0, 3);
  const card = (key: string, label: string, href: string, list: BatchRow[], tone: ExpiryCard["tone"]): ExpiryCard => ({
    key, label, href, tone,
    batches: list.length,
    quantity: round3(list.reduce((s, r) => s + r.quantity, 0)),
    value: round2(list.reduce((s, r) => s + r.value, 0)),
  });
  const expired = rows.filter((r) => r.status.code === "EXPIRED");
  const cards: ExpiryCard[] = [
    card("expired", "মেয়াদোত্তীর্ণ", "/products/batches?status=expired", expired, "red"),
    ...bands.map((d) =>
      card(`d${d}`, `${toBnDigits(d)} দিনের মধ্যে মেয়াদ শেষ`, `/products/batches?within=${d}`, rows.filter((r) => matchesFilter(r.status, "all", d)), "amber"),
    ),
  ];
  const attention = rows.filter((r) => r.status.code === "EXPIRED" || r.status.code === "TODAY" || r.status.code === "SOON").slice(0, 8);
  return { cards, attention, expiredValue: round2(expired.reduce((s, r) => s + r.value, 0)), bands };
}

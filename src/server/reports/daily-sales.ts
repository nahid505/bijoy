import "server-only";
import type { Prisma } from "@prisma/client";
import { voucherScopeWhere } from "../party-scope";
// ডেইলি বিক্রয় রিপোর্ট for one date: every line of the day's SALES vouchers (sales form and POS).
//
//   টাকা       = the line amount as posted (পরিমাণ × দর − line discount)
//   মোট পরিমাণ = per unit (কেজি and পিস are never added together)
//   সর্বমোট    = Σ line amounts; voucher-level discount / VAT and the collected / due split are shown below
// Sales returns are not sales and are left out.
import { prisma, num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { dayOrToday, formatDate, formatMoney, formatQty } from "@/lib/format";
import type { ReportDef, ReportRow } from "./types";

export interface SalesLine {
  voucherId: string;
  voucherNo: string;
  /** customer, or "নগদ বিক্রয়" */
  party: string;
  product: string;
  unit: string;
  quantity: number;
  rate: number;
  discount: number;
  amount: number;
  /** চালান note: reference, batch, narration */
  note: string;
}

export interface DailySales {
  date: string;
  lines: SalesLine[];
  invoices: number;
  quantityByUnit: { unit: string; quantity: number }[];
  total: number;
  discount: number;
  vat: number;
  net: number;
  collected: number;
  due: number;
}

const CASH = "নগদ বিক্রয়";

/** params.scope: voucherScopeWhere(ctx) (assigned-only roles). */
export async function dailySales(businessId: string, params: { date?: string; scope?: Prisma.VoucherWhereInput }): Promise<DailySales> {
  const date = dayOrToday(params.date);
  const day = new Date(`${date}T00:00:00.000Z`);
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + 1);

  const vouchers = await prisma.voucher.findMany({
    where: { businessId, book: "GENERAL", type: "SALES", date: { gte: day, lt: next }, ...params.scope },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true, voucherNo: true, reference: true, narration: true, discount: true, vatAmount: true, amount: true, paidAmount: true,
      partyAccount: { select: { name: true } },
      items: { orderBy: { lineNo: "asc" }, select: { quantity: true, rate: true, discount: true, amount: true, batchNo: true, product: { select: { name: true, unit: { select: { name: true } } } }, unit: { select: { name: true } } } },
    },
  });

  const lines: SalesLine[] = vouchers.flatMap((v) =>
    v.items.map((i) => ({
      voucherId: v.id,
      voucherNo: v.voucherNo,
      party: v.partyAccount?.name ?? CASH,
      product: i.product.name,
      unit: i.unit?.name ?? i.product.unit.name,
      quantity: num(i.quantity),
      rate: num(i.rate),
      discount: num(i.discount),
      amount: num(i.amount),
      note: [v.reference ? `চালান ${v.reference}` : null, i.batchNo ? `ব্যাচ ${i.batchNo}` : null, v.narration].filter(Boolean).join(" · "),
    })),
  );

  const byUnit = new Map<string, number>();
  for (const l of lines) byUnit.set(l.unit, round3((byUnit.get(l.unit) ?? 0) + l.quantity));
  const sum = (pick: (v: (typeof vouchers)[number]) => Parameters<typeof num>[0]) => round2(vouchers.reduce((s, v) => s + num(pick(v)), 0));
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const net = sum((v) => v.amount);
  const collected = sum((v) => v.paidAmount);
  return {
    date,
    lines,
    invoices: vouchers.length,
    quantityByUnit: [...byUnit].map(([unit, quantity]) => ({ unit, quantity })).sort((a, b) => b.quantity - a.quantity),
    total,
    discount: sum((v) => v.discount),
    vat: sum((v) => v.vatAmount),
    net,
    collected,
    due: round2(net - collected),
  };
}

/** "১২০ কেজি · ৫ পিস" */
export function quantityText(q: DailySales["quantityByUnit"]): string {
  return q.length ? q.map((x) => `${formatQty(x.quantity)} ${x.unit}`).join(" · ") : "০";
}

/** Registry entry: the reports index and the CSV / Excel export (the screen has its own page). */
export const DAILY_SALES_REPORT: ReportDef = {
  slug: "daily-sales",
  title: "ডেইলি বিক্রয় রিপোর্ট",
  description: "নির্দিষ্ট দিনের বিক্রয় — পার্টি, পণ্য, পরিমাণ, দর, টাকা ও নোট; মোট পরিমাণ ও সর্বমোট বিক্রয়সহ A4 প্রিন্ট",
  filters: [],
  permission: "sales:view",
  async run(ctx, p) {
    const d = await dailySales(ctx.business.id, { date: p.date, scope: voucherScopeWhere(ctx) });
    const cur = ctx.business.currencySymbol;
    const rows: ReportRow[] = [
      ...d.lines.map((l, i): ReportRow => ({
        href: `/vouchers/v/${l.voucherId}`,
        cells: { no: String(i + 1), party: `${l.party} (${l.voucherNo})`, product: l.product, quantity: l.quantity, unit: l.unit, rate: l.rate, amount: l.amount, note: l.note },
      })),
      { kind: "total", cells: { no: null, party: "মোট পরিমাণ ও সর্বমোট বিক্রয় টাকা", product: "", quantity: d.quantityByUnit.length === 1 ? d.quantityByUnit[0].quantity : null, unit: d.quantityByUnit.length === 1 ? d.quantityByUnit[0].unit : quantityText(d.quantityByUnit), rate: null, amount: d.total, note: "" } },
      ...(d.discount || d.vat
        ? [{ kind: "subtotal" as const, cells: { no: null, party: "নিট বিক্রয় (ভাউচার ছাড় ও ভ্যাটসহ)", product: "", quantity: null, unit: "", rate: null, amount: d.net, note: "" } }]
        : []),
    ];
    return {
      title: "ডেইলি বিক্রয় রিপোর্ট",
      subtitle: formatDate(d.date),
      columns: [
        { key: "no", label: "নম্বর" },
        { key: "party", label: "পার্টির নাম" },
        { key: "product", label: "পণ্যের নাম" },
        { key: "quantity", label: "পরিমাণ", format: "qty" },
        { key: "unit", label: "একক" },
        { key: "rate", label: "দর", format: "money" },
        { key: "amount", label: "টাকা", format: "money" },
        { key: "note", label: "নোট" },
      ],
      rows,
      summary: [
        { label: "চালান", value: String(d.invoices) },
        { label: "সর্বমোট বিক্রয়", value: formatMoney(d.net, cur), tone: "blue" },
        { label: "নগদ আদায়", value: formatMoney(d.collected, cur), tone: "green" },
        { label: "বাকি", value: formatMoney(d.due, cur), tone: "red" },
      ],
    };
  },
};

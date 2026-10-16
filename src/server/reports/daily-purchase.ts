import "server-only";
// ডেইলি ক্রয় রিপোর্ট for one date, in two sections:
//   ১. অন্যান্য ক্রয় — every line of the day's purchase vouchers that are not paddy weighbridge slips
//      (মোট টাকা = পরিমাণ × দর − line discount, as posted; voucher-level discount / VAT shown below the total)
//   ২. ধান ক্রয়    — the day's paddy slips: bags, gross, dhalta, net kg, mon, rate per mon, total
// Purchase returns are not purchases and are left out.
import { prisma, num } from "@/lib/db";
import { round2, round3 } from "@/lib/calc";
import { dayOrToday, formatDate, formatMoney } from "@/lib/format";
import type { ReportDef, ReportRow } from "./types";

export interface OtherPurchaseLine {
  voucherId: string;
  voucherNo: string;
  /** বিবরণ: the supplier, or "নগদ ক্রয়" */
  party: string;
  product: string;
  unit: string;
  quantity: number;
  rate: number;
  discount: number;
  amount: number;
  /** batch and the voucher's narration */
  note: string;
}

export interface PaddyLine {
  voucherId: string;
  voucherNo: string;
  party: string;
  /** the paddy product (variety) of the slip */
  product: string;
  bagCount: number;
  grossKg: number;
  dhaltaKg: number;
  netKg: number;
  mon: number;
  ratePerMon: number;
  totalPrice: number;
  notes: string | null;
}

export interface DailyPurchase {
  date: string;
  other: OtherPurchaseLine[];
  otherTotal: number;
  /** voucher-level adjustments of the other purchases (not part of any line) */
  otherDiscount: number;
  otherVat: number;
  otherNet: number;
  paddy: PaddyLine[];
  paddyTotals: { bags: number; grossKg: number; dhaltaKg: number; netKg: number; mon: number; total: number };
  grandTotal: number;
}

const CASH = "নগদ ক্রয়";

export async function dailyPurchase(businessId: string, params: { date?: string }): Promise<DailyPurchase> {
  const date = dayOrToday(params.date);
  const day = new Date(`${date}T00:00:00.000Z`);
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + 1);
  const range = { gte: day, lt: next };

  const [vouchers, slips] = await Promise.all([
    prisma.voucher.findMany({
      where: { businessId, type: "PURCHASE", date: range, paddyPurchase: { is: null } },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true, voucherNo: true, narration: true, discount: true, vatAmount: true,
        partyAccount: { select: { name: true } },
        items: { orderBy: { lineNo: "asc" }, select: { quantity: true, rate: true, discount: true, amount: true, batchNo: true, product: { select: { name: true, unit: { select: { name: true } } } }, unit: { select: { name: true } } } },
      },
    }),
    prisma.paddyPurchase.findMany({
      where: { businessId, voucher: { date: range } },
      orderBy: [{ voucher: { createdAt: "asc" } }],
      include: { voucher: { select: { id: true, voucherNo: true, partyAccount: { select: { name: true } }, items: { orderBy: { lineNo: "asc" }, take: 1, select: { product: { select: { name: true } } } } } } },
    }),
  ]);

  const other: OtherPurchaseLine[] = vouchers.flatMap((v) =>
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
      note: [i.batchNo ? `ব্যাচ ${i.batchNo}` : null, v.narration].filter(Boolean).join(" · "),
    })),
  );
  const otherTotal = round2(other.reduce((s, l) => s + l.amount, 0));
  const otherDiscount = round2(vouchers.reduce((s, v) => s + num(v.discount), 0));
  const otherVat = round2(vouchers.reduce((s, v) => s + num(v.vatAmount), 0));

  const paddy: PaddyLine[] = slips.map((p) => ({
    voucherId: p.voucher.id,
    voucherNo: p.voucher.voucherNo,
    party: p.voucher.partyAccount?.name ?? CASH,
    product: p.voucher.items[0]?.product.name ?? "ধান",
    bagCount: p.bagCount,
    grossKg: num(p.grossKg),
    dhaltaKg: num(p.dhaltaKg),
    netKg: num(p.netKg),
    mon: num(p.mon),
    ratePerMon: num(p.ratePerMon),
    totalPrice: num(p.totalPrice),
    notes: p.notes,
  }));
  const sum = (f: (l: PaddyLine) => number) => paddy.reduce((s, l) => s + f(l), 0);
  const paddyTotals = {
    bags: sum((l) => l.bagCount),
    grossKg: round3(sum((l) => l.grossKg)),
    dhaltaKg: round3(sum((l) => l.dhaltaKg)),
    netKg: round3(sum((l) => l.netKg)),
    mon: round2(sum((l) => l.mon)),
    total: round2(sum((l) => l.totalPrice)),
  };
  const otherNet = round2(otherTotal - otherDiscount + otherVat);
  return { date, other, otherTotal, otherDiscount, otherVat, otherNet, paddy, paddyTotals, grandTotal: round2(otherNet + paddyTotals.total) };
}

/** Registry entry: the reports index and the CSV / Excel export (the screen has its own page). */
export const DAILY_PURCHASE_REPORT: ReportDef = {
  slug: "daily-purchase",
  title: "ডেইলি ক্রয় রিপোর্ট",
  description: "নির্দিষ্ট দিনের অন্যান্য ক্রয় (পণ্য, পরিমাণ, দর) ও ধান ক্রয় (বস্তা, স্কেল, ঢলতা, মণ, দর) — খাতার মতো A4 প্রিন্টসহ",
  filters: [],
  permission: "purchases:view",
  async run(ctx, p) {
    const d = await dailyPurchase(ctx.business.id, { date: p.date });
    const cur = ctx.business.currencySymbol;
    const blank = { product: "", bags: null, gross: null, dhalta: null, net: null, mon: null };
    const rows: ReportRow[] = [
      { kind: "group", cells: { no: null, particulars: "১. ডেইলি ক্রয় রিপোর্ট (অন্যান্য ক্রয়)", ...blank, quantity: null, rate: null, amount: null, note: "" } },
      ...d.other.map((l, i): ReportRow => ({ href: `/vouchers/v/${l.voucherId}`, cells: { no: String(i + 1), particulars: `${l.party} (${l.voucherNo})`, ...blank, product: l.product, quantity: `${l.quantity} ${l.unit}`, rate: l.rate, amount: l.amount, note: l.note } })),
      { kind: "total", cells: { no: null, particulars: "মোট টাকা", ...blank, quantity: null, rate: null, amount: d.otherTotal, note: "" } },
      ...(d.otherDiscount || d.otherVat ? [{ kind: "subtotal" as const, cells: { no: null, particulars: "নিট (ভাউচার ছাড় ও ভ্যাটসহ)", ...blank, quantity: null, rate: null, amount: d.otherNet, note: "" } }] : []),
      { kind: "group", cells: { no: null, particulars: "২. ধান ক্রয় রিপোর্ট", ...blank, quantity: null, rate: null, amount: null, note: "" } },
      ...d.paddy.map((l, i): ReportRow => ({
        href: `/vouchers/v/${l.voucherId}`,
        cells: { no: String(i + 1), particulars: l.party, product: l.product, bags: l.bagCount, gross: l.grossKg, dhalta: l.dhaltaKg, net: l.netKg, mon: l.mon, quantity: null, rate: l.ratePerMon, amount: l.totalPrice, note: [l.voucherNo, l.notes].filter(Boolean).join(" · ") },
      })),
      { kind: "total", cells: { no: null, particulars: "মোট", product: "", bags: d.paddyTotals.bags, gross: d.paddyTotals.grossKg, dhalta: d.paddyTotals.dhaltaKg, net: d.paddyTotals.netKg, mon: d.paddyTotals.mon, quantity: null, rate: null, amount: d.paddyTotals.total, note: "" } },
      { kind: "total", cells: { no: null, particulars: "সর্বমোট ক্রয় (অন্যান্য + ধান)", ...blank, quantity: null, rate: null, amount: d.grandTotal, note: "" } },
    ];
    return {
      title: "ডেইলি ক্রয় রিপোর্ট",
      subtitle: formatDate(d.date),
      columns: [
        { key: "no", label: "নম্বর" },
        { key: "particulars", label: "বিবরণ / পার্টির নাম" },
        { key: "product", label: "পণ্যের নাম" },
        { key: "quantity", label: "পরিমাণ" },
        { key: "bags", label: "বস্তা", format: "qty" },
        { key: "gross", label: "মোট স্কেল (কেজি)", format: "qty" },
        { key: "dhalta", label: "ঢলতা (কেজি)", format: "qty" },
        { key: "net", label: "নীট স্কেল (কেজি)", format: "qty" },
        { key: "mon", label: "মণ", format: "qty" },
        { key: "rate", label: "দর", format: "money" },
        { key: "amount", label: "মোট টাকা", format: "money" },
        { key: "note", label: "নোট" },
      ],
      rows,
      summary: [
        { label: "অন্যান্য ক্রয়", value: formatMoney(d.otherNet, cur) },
        { label: "ধান ক্রয়", value: formatMoney(d.paddyTotals.total, cur) },
        { label: "সর্বমোট ক্রয়", value: formatMoney(d.grandTotal, cur), tone: "blue" },
      ],
    };
  },
};

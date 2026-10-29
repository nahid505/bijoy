import "server-only";
import { round2 } from "@/lib/calc";
import { dayOrToday, dayRange, formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { KG_PER_MON } from "@/lib/paddy";
import { reportPeriod } from "../period";
import { dailyMilling, millSales, millStock, millSummary } from "../services/rice-mill";
import type { ReportDef, ReportResult, ReportRow } from "./types";
import { REPORT_ACCESS } from "@/lib/permissions";

const qtyText = (q: number, unit: string) => {
  const kg = /কেজি|kg/i.test(unit);
  return `${formatQty(q)} ${unit}${kg && q ? ` (${toBnDigits((q / KG_PER_MON).toFixed(2))} মণ)` : ""}`;
};
const periodText = (from: string, to: string) => `${formatDate(from)} — ${formatDate(to)}`;
const pct = (p: number | null) => (p === null ? "" : `${toBnDigits(p.toFixed(2))}%`);

/**
 * "মিল লাভ-ক্ষতি ও স্টক রিপোর্ট": paddy bought (by variety), milling yield, sales of rice and by-products with their cost,
 * the mill's gross profit after the paddy labour, and the stock now.
 */
async function riceMillReport(ctx: Parameters<ReportDef["run"]>[0], p: Record<string, string | undefined>): Promise<ReportResult> {
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  const [sum, sales, stock] = await Promise.all([millSummary(ctx.business.id, range), millSales(ctx.business.id, range), millStock(ctx.business.id)]);
  const rows: ReportRow[] = [];
  const group = (t: string) => rows.push({ kind: "group", cells: { particulars: t, quantity: "", percent: "", amount: null } });
  const line = (particulars: string, quantity: string, percent: string, amount: number | null, kind: ReportRow["kind"] = "normal") => rows.push({ kind, cells: { particulars, quantity, percent, amount } });

  group("১. ধান ক্রয় (জাত অনুযায়ী)");
  for (const v of sum.purchase.byVariety) line(`${v.variety} — ${toBnDigits(v.slips)} টি স্লিপ`, qtyText(v.netKg, "কেজি"), "", v.amount);
  line("মোট ধান ক্রয়", qtyText(sum.purchase.netKg, "কেজি"), "", sum.purchase.amount, "subtotal");
  line("লেবার খরচ (নামানো / বহন)", "", "", sum.labourCost);

  group("২. মিলিং ও ফলন");
  for (const m of sum.milling.milled) line(`প্রসেসিংয়ে দেওয়া: ${m.name}`, qtyText(m.quantity, m.unit), "১০০%", null);
  for (const o of sum.milling.produced) line(`উৎপাদন: ${o.name}`, qtyText(o.quantity, o.unit), pct(o.percent), null);
  line("প্রসেস লস (ধুলা, আর্দ্রতা)", qtyText(sum.milling.lossKg, "কেজি"), pct(sum.milling.lossPercent), null, "subtotal");
  line(`উৎপাদন খরচ (মজুরি, বিদ্যুৎ …) — ${toBnDigits(sum.milling.runs)} টি ব্যাচ`, "", "", sum.milling.extraCost);

  group("৩. চাল ও উপজাত বিক্রয়");
  for (const s of sales.products) {
    const margin = s.revenue ? round2(((s.revenue - s.cost) / s.revenue) * 100) : null;
    line(`${s.name} — বিক্রয় ${formatMoney(s.revenue, cur)}, খরচ ${formatMoney(s.cost, cur)}`, qtyText(s.quantity, s.unit), pct(margin), round2(s.revenue - s.cost));
  }
  const gross = round2(sales.revenue - sales.cost);
  line("মোট বিক্রয়", "", "", sales.revenue, "subtotal");
  line("বিক্রিত চাল ও উপজাতের খরচ (ধান + উৎপাদন খরচ)", "", "", sales.cost);
  line("মোট লাভ (বিক্রয় − খরচ)", "", "", gross, "subtotal");
  const net = round2(gross - sum.labourCost);
  line("মিলের লাভ (লেবার খরচের পর)", "", "", net, "total");

  group("৪. বর্তমান মজুদ");
  for (const r of [...stock.paddy, ...stock.outputs]) line(r.name, qtyText(r.stock, r.unit), "", r.value);
  line("মোট মজুদ মূল্য (গড় ক্রয়মূল্যে)", "", "", round2(stock.paddyValue + stock.outputValue), "total");

  const yieldOf = (re: RegExp) => sum.milling.produced.filter((o) => re.test(o.name)).reduce((s, o) => s + (o.percent ?? 0), 0);
  return {
    title: "মিল লাভ-ক্ষতি ও স্টক রিপোর্ট",
    subtitle: periodText(from, to),
    columns: [
      { key: "particulars", label: "বিবরণ" },
      { key: "quantity", label: "পরিমাণ" },
      { key: "percent", label: "ফলন / মার্জিন" },
      { key: "amount", label: "টাকা", format: "money" },
    ],
    rows,
    summary: [
      { label: "ধান ক্রয়", value: `${qtyText(sum.purchase.netKg, "কেজি")}` },
      { label: "চালের ফলন", value: pct(round2(yieldOf(/চাল/))), tone: "blue" },
      { label: "চাল ও উপজাত বিক্রয়", value: formatMoney(sales.revenue, cur), tone: "green" },
      { label: "মিলের লাভ", value: formatMoney(net, cur), tone: net < 0 ? "red" : "green" },
    ],
    notes: [
      "বিক্রয় = বিক্রয় ভাউচারের লাইনের টাকা (ভাউচার-স্তরের ছাড় ও ভ্যাট বাদে), বিক্রয় ফেরত বাদ দিয়ে।",
      "খরচ = বিক্রির সময়ের গড় ক্রয়মূল্য — ধানের দাম ও উৎপাদন খরচ (মজুরি, বিদ্যুৎ) উৎপাদনের সময় চাল ও উপজাতে ভাগ হয়ে যুক্ত হয়।",
      "ফলন % = উৎপাদিত পরিমাণ ÷ প্রসেসিংয়ে দেওয়া ধান (শুধু কেজি এককের পণ্য)।",
    ],
    emptyMessage: "এই সময়ে মিলের কোনো লেনদেন নেই",
  };
}

export const RICE_MILL_REPORT: ReportDef = {
  slug: "rice-mill",
  title: "মিল লাভ-ক্ষতি ও স্টক রিপোর্ট",
  description: "ধান ক্রয় (জাত অনুযায়ী), মিলিং ফলন ও প্রসেস লস, চাল ও উপজাত বিক্রয়ের লাভ এবং বর্তমান মজুদ",
  filters: ["range"],
  permission: "reports:view",
  run: riceMillReport,
};

/** "4,500.00 কেজি / 90 বস্তা" — bags only when known */
export const millQtyText = (q: { kg: number; bags: number | null }) =>
  q.kg ? `${formatQty(q.kg)} কেজি${q.bags ? ` / ${toBnDigits(Number.isInteger(q.bags) ? String(q.bags) : q.bags.toFixed(2))} বস্তা` : ""}` : "—";

/**
 * "ডেইলি ধান ভাঙানো হিসাব" — the screen has its own page (/reports/daily-milling); this entry serves the reports
 * index and the CSV / Excel export (?date=YYYY-MM-DD).
 */
export const DAILY_MILLING_REPORT: ReportDef = {
  slug: "daily-milling",
  title: "ডেইলি ধান ভাঙানো হিসাব",
  description: "দিনের প্রতিটি মিলিং ব্যাচ — ধানের জাত, বস্তা ও পরিমাণ, উৎপাদিত চাল, কুঁড়া, খুদ ও তুষ, ফলন % ও অপারেটর",
  filters: [],
  permission: REPORT_ACCESS.dailyMilling,
  async run(ctx, p) {
    const date = dayOrToday(p.date);
    const d = await dailyMilling(ctx.business.id, dayRange(date, date));
    const pct = (n: number) => `${toBnDigits(n.toFixed(2))}%`;
    const rows: ReportRow[] = d.rows.map((r, i) => ({
      href: `/production/${r.voucherId}`,
      cells: {
        no: toBnDigits(i + 1), batch: r.batchNo, date: r.date, paddy: r.paddyNames,
        paddyQty: `${millQtyText(r.paddy)} (${toBnDigits(r.paddy.mon.toFixed(2))} মণ)`,
        rice: millQtyText(r.rice), bran: millQtyText(r.bran), broken: millQtyText(r.broken), husk: millQtyText(r.husk),
        yield: `চাল ${pct(r.yields.rice)} · কুঁড়া ${pct(r.yields.bran)} · খুদ ${pct(r.yields.broken)} · তুষ ${pct(r.yields.husk)} · লস ${pct(r.yields.loss)}`,
        operator: r.enteredBy ?? "",
      },
    }));
    rows.push({
      kind: "total",
      cells: {
        no: null, batch: `মোট (${toBnDigits(d.rows.length)} টি ব্যাচ)`, date: null, paddy: "",
        paddyQty: `${millQtyText(d.totals.paddy)} (${toBnDigits(d.totals.paddy.mon.toFixed(2))} মণ)`,
        rice: millQtyText(d.totals.rice), bran: millQtyText(d.totals.bran), broken: millQtyText(d.totals.broken), husk: millQtyText(d.totals.husk),
        yield: `চাল ${pct(d.yields.rice)} · কুঁড়া ${pct(d.yields.bran)} · খুদ ${pct(d.yields.broken)} · তুষ ${pct(d.yields.husk)} · লস ${pct(d.yields.loss)}`,
        operator: "",
      },
    });
    return {
      title: "ডেইলি ধান ভাঙানো হিসাব",
      subtitle: formatDate(date),
      columns: [
        { key: "no", label: "নং" },
        { key: "batch", label: "মিলিং ব্যাচ নং" },
        { key: "date", label: "তারিখ", format: "date" },
        { key: "paddy", label: "ধানের জাত" },
        { key: "paddyQty", label: "ভাঙানো ধান (কেজি / বস্তা)" },
        { key: "rice", label: "মূল চাল" },
        { key: "bran", label: "কুঁড়া / ব্র্যান" },
        { key: "broken", label: "খুদ / ভাঙা চাল" },
        { key: "husk", label: "তুষ / ভূসি" },
        { key: "yield", label: "উৎপাদন হার" },
        { key: "operator", label: "অপারেটর / এন্ট্রিদাতা" },
      ],
      rows,
      emptyMessage: "এই দিনে কোনো মিলিং ব্যাচ নেই",
    };
  },
};

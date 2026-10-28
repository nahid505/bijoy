import "server-only";
import { round2 } from "@/lib/calc";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { KG_PER_MON } from "@/lib/paddy";
import { reportPeriod } from "../period";
import { millSales, millStock, millSummary } from "../services/rice-mill";
import type { ReportDef, ReportResult, ReportRow } from "./types";

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

import "server-only";
import { round2, round3 } from "@/lib/calc";
import { EXPIRY_LABELS, normalizeThresholds } from "@/lib/expiry";
import { formatDate, formatMoney, formatQty, toBnDigits, toDateInput } from "@/lib/format";
import { listBatches, type BatchRow } from "../services/expiry";
import type { ReportDef, ReportParams, ReportResult, ReportRow } from "./types";
import type { AppContext } from "../auth";

const todayOf = () => new Date(`${toDateInput()}T00:00:00.000Z`);
const statusText = (r: BatchRow) =>
  `${EXPIRY_LABELS[r.status.code]}${r.status.code === "SOON" ? ` (${toBnDigits(r.status.daysLeft!)} দিন)` : r.status.code === "EXPIRED" ? ` (${toBnDigits(-r.status.daysLeft!)} দিন আগে)` : ""}`;
const VALUE_NOTE = "মূল্য = মজুদ × ব্যাচের ক্রয়মূল্য (ব্যাচের ক্রয়মূল্য না থাকলে পণ্যের গড় ক্রয়মূল্য)। বাতিল (write-off) করার সময় হিসাবনীতি অনুযায়ী চলতি গড় ক্রয়মূল্যে খরচ পোস্ট হয়।";

const batchColumns = [
  { key: "product", label: "পণ্য" },
  { key: "batch", label: "ব্যাচ" },
  { key: "mfg", label: "উৎপাদন", format: "date" as const },
  { key: "expiry", label: "মেয়াদ শেষ", format: "date" as const },
  { key: "status", label: "অবস্থা" },
  { key: "qty", label: "মজুদ", format: "qty" as const },
  { key: "cost", label: "ক্রয়মূল্য", format: "money" as const },
  { key: "value", label: "মজুদ মূল্য", format: "money" as const },
];

function batchRows(list: BatchRow[]): ReportRow[] {
  const rows: ReportRow[] = list.map((r) => ({
    href: `/products/batches?product=${r.productId}`,
    cells: { product: r.productName, batch: r.batchNo, mfg: r.mfgDate, expiry: r.expiryDate, status: statusText(r), qty: r.quantity, cost: r.costPrice, value: r.value, supplier: r.supplierName ?? "" },
  }));
  if (list.length) {
    rows.push({ kind: "total", cells: { product: `মোট ${toBnDigits(list.length)} টি ব্যাচ`, qty: round3(list.reduce((s, r) => s + r.quantity, 0)), value: round2(list.reduce((s, r) => s + r.value, 0)) } });
  }
  return rows;
}

async function batches(ctx: AppContext, p: ReportParams) {
  return listBatches(ctx.business.id, todayOf(), { q: p.q });
}

export const EXPIRY_REPORTS: ReportDef[] = [
  {
    slug: "expired-stock",
    title: "মেয়াদোত্তীর্ণ মজুদ",
    description: "যে ব্যাচগুলোর মেয়াদ শেষ হয়ে গেছে কিন্তু এখনো মজুদে আছে — বিক্রি করা যাবে না, বাতিল করুন",
    filters: ["q"],
    permission: "reports:view",
    async run(ctx, p): Promise<ReportResult> {
      const list = (await batches(ctx, p)).filter((r) => r.status.code === "EXPIRED");
      const value = round2(list.reduce((s, r) => s + r.value, 0));
      return {
        title: "মেয়াদোত্তীর্ণ মজুদ",
        subtitle: `${formatDate(todayOf())} পর্যন্ত`,
        columns: [...batchColumns, { key: "supplier", label: "সরবরাহকারী" }],
        rows: batchRows(list),
        summary: [
          { label: "মেয়াদোত্তীর্ণ ব্যাচ", value: toBnDigits(list.length), tone: list.length ? "red" : "green" },
          { label: "মেয়াদোত্তীর্ণ মজুদের মোট মূল্য", value: formatMoney(value, ctx.business.currencySymbol), tone: value ? "red" : "green" },
        ],
        notes: [VALUE_NOTE],
        emptyMessage: "কোনো মেয়াদোত্তীর্ণ মজুদ নেই ✅",
      };
    },
  },
  {
    slug: "expiring-stock",
    title: "শীঘ্রই মেয়াদ শেষ হবে এমন মজুদ",
    description: "নির্দিষ্ট তারিখের মধ্যে মেয়াদ শেষ হবে এমন ব্যাচ (ডিফল্ট: প্রথম সতর্কতার সময়সীমা)",
    filters: ["asOf", "q"],
    permission: "reports:view",
    async run(ctx, p): Promise<ReportResult> {
      const today = todayOf();
      const horizon = Math.max(...normalizeThresholds(ctx.business.expiryWarningDays));
      const until = p.asOf && /^\d{4}-\d{2}-\d{2}$/.test(p.asOf) ? new Date(`${p.asOf}T00:00:00.000Z`) : new Date(today.getTime() + horizon * 86_400_000);
      const list = (await batches(ctx, p)).filter((r) => r.expiryDate && r.status.code !== "EXPIRED" && r.expiryDate.getTime() <= until.getTime());
      return {
        title: "শীঘ্রই মেয়াদ শেষ হবে এমন মজুদ",
        subtitle: `${formatDate(today)} — ${formatDate(until)} এর মধ্যে মেয়াদ শেষ`,
        columns: [...batchColumns, { key: "supplier", label: "সরবরাহকারী" }],
        rows: batchRows(list),
        summary: [
          { label: "ব্যাচ", value: toBnDigits(list.length), tone: list.length ? "red" : "green" },
          { label: "মোট মূল্য", value: formatMoney(round2(list.reduce((s, r) => s + r.value, 0)), ctx.business.currencySymbol) },
        ],
        notes: [VALUE_NOTE],
        emptyMessage: "এই সময়ের মধ্যে কোনো ব্যাচের মেয়াদ শেষ হচ্ছে না",
      };
    },
  },
  {
    slug: "expiry",
    title: "ব্যাচভিত্তিক মেয়াদ রিপোর্ট",
    description: "মজুদে থাকা প্রতিটি ব্যাচ — উৎপাদন ও মেয়াদের তারিখ, অবস্থা, মজুদ ও মূল্য (আগে মেয়াদ শেষ আগে)",
    filters: ["q"],
    permission: "reports:view",
    async run(ctx, p): Promise<ReportResult> {
      const list = await batches(ctx, p);
      const count = (codes: string[]) => list.filter((r) => codes.includes(r.status.code)).length;
      return {
        title: "ব্যাচভিত্তিক মেয়াদ রিপোর্ট",
        subtitle: `${formatDate(todayOf())} অনুযায়ী`,
        columns: [...batchColumns, { key: "supplier", label: "সরবরাহকারী" }],
        rows: batchRows(list),
        summary: [
          { label: "🔴 মেয়াদোত্তীর্ণ", value: toBnDigits(count(["EXPIRED"])), tone: "red" },
          { label: "🟠 শীঘ্রই মেয়াদ শেষ", value: toBnDigits(count(["TODAY", "SOON"])), tone: "slate" },
          { label: "🟢 বৈধ", value: toBnDigits(count(["VALID", "NONE"])), tone: "green" },
        ],
        notes: [VALUE_NOTE],
        emptyMessage: "মজুদে কোনো ব্যাচ নেই",
      };
    },
  },
  {
    slug: "product-expiry",
    title: "পণ্যভিত্তিক মেয়াদ রিপোর্ট",
    description: "প্রতিটি ব্যাচভিত্তিক পণ্যের মোট মজুদ কতটা বৈধ, শীঘ্রই মেয়াদ শেষ ও মেয়াদোত্তীর্ণ",
    filters: ["q"],
    permission: "reports:view",
    async run(ctx, p): Promise<ReportResult> {
      const list = await batches(ctx, p);
      const by = new Map<string, BatchRow[]>();
      for (const r of list) by.set(r.productId, [...(by.get(r.productId) ?? []), r]);
      const sum = (rs: BatchRow[], f: (r: BatchRow) => boolean) => round3(rs.filter(f).reduce((s, r) => s + r.quantity, 0));
      const rows: ReportRow[] = [...by.values()]
        .map((rs) => {
          const nearest = rs.filter((r) => r.expiryDate && r.status.code !== "EXPIRED").sort((a, b) => a.expiryDate!.getTime() - b.expiryDate!.getTime())[0];
          return {
            href: `/products/batches?product=${rs[0].productId}`,
            cells: {
              product: rs[0].productName,
              batches: rs.length,
              total: sum(rs, () => true),
              valid: sum(rs, (r) => r.status.code === "VALID" || r.status.code === "NONE"),
              soon: sum(rs, (r) => r.status.code === "SOON" || r.status.code === "TODAY"),
              expired: sum(rs, (r) => r.status.code === "EXPIRED"),
              nearest: nearest?.expiryDate ?? null,
              expiredValue: round2(rs.filter((r) => r.status.code === "EXPIRED").reduce((s, r) => s + r.value, 0)),
              value: round2(rs.reduce((s, r) => s + r.value, 0)),
            },
          } satisfies ReportRow;
        })
        .sort((a, b) => Number(b.cells.expired) - Number(a.cells.expired) || Number(b.cells.soon) - Number(a.cells.soon));
      return {
        title: "পণ্যভিত্তিক মেয়াদ রিপোর্ট",
        subtitle: `${formatDate(todayOf())} অনুযায়ী`,
        columns: [
          { key: "product", label: "পণ্য" },
          { key: "batches", label: "ব্যাচ", format: "qty" },
          { key: "total", label: "মোট মজুদ", format: "qty" },
          { key: "valid", label: "🟢 বৈধ", format: "qty" },
          { key: "soon", label: "🟠 শীঘ্রই শেষ", format: "qty" },
          { key: "expired", label: "🔴 মেয়াদোত্তীর্ণ", format: "qty" },
          { key: "nearest", label: "নিকটতম মেয়াদ", format: "date" },
          { key: "expiredValue", label: "মেয়াদোত্তীর্ণ মূল্য", format: "money" },
          { key: "value", label: "মোট মূল্য", format: "money" },
        ],
        rows,
        notes: [VALUE_NOTE],
        emptyMessage: "কোনো ব্যাচভিত্তিক পণ্যের মজুদ নেই",
      };
    },
  },
  {
    slug: "expiry-value",
    title: "মেয়াদ অনুযায়ী মজুদ মূল্য",
    description: "মজুদ মূল্য (পরিমাণ × ক্রয়মূল্য) মেয়াদের ধাপ অনুযায়ী — কত টাকার পণ্য ইতিমধ্যে মেয়াদোত্তীর্ণ",
    filters: ["q"],
    permission: "reports:view",
    async run(ctx, p): Promise<ReportResult> {
      const list = await batches(ctx, p);
      const bands = [...normalizeThresholds(ctx.business.expiryWarningDays)].sort((a, b) => a - b);
      const groups: { label: string; match: (r: BatchRow) => boolean }[] = [
        { label: "🔴 মেয়াদোত্তীর্ণ", match: (r) => r.status.code === "EXPIRED" },
        { label: "🟠 আজ মেয়াদ শেষ", match: (r) => r.status.code === "TODAY" },
        ...bands.map((d, i) => ({
          label: `🟠 ${i === 0 ? "১" : toBnDigits(bands[i - 1] + 1)}–${toBnDigits(d)} দিনের মধ্যে`,
          match: (r: BatchRow) => r.status.code === "SOON" && r.status.level === d,
        })),
        { label: "🟢 বৈধ (সতর্কতার বাইরে)", match: (r) => r.status.code === "VALID" },
        { label: "⚪ মেয়াদ দেওয়া নেই", match: (r) => r.status.code === "NONE" },
      ];
      const total = round2(list.reduce((s, r) => s + r.value, 0));
      const rows: ReportRow[] = groups.map((g) => {
        const rs = list.filter(g.match);
        const value = round2(rs.reduce((s, r) => s + r.value, 0));
        return { cells: { band: g.label, batches: rs.length, qty: round3(rs.reduce((s, r) => s + r.quantity, 0)), value, share: total ? `${toBnDigits(((value / total) * 100).toFixed(1))}%` : "—" } };
      });
      rows.push({ kind: "total", cells: { band: "মোট", batches: list.length, qty: round3(list.reduce((s, r) => s + r.quantity, 0)), value: total, share: total ? "১০০%" : "—" } });
      const expired = list.filter((r) => r.status.code === "EXPIRED");
      const expiredValue = round2(expired.reduce((s, r) => s + r.value, 0));
      const cur = ctx.business.currencySymbol;
      return {
        title: "মেয়াদ অনুযায়ী মজুদ মূল্য",
        subtitle: `${formatDate(todayOf())} অনুযায়ী`,
        columns: [
          { key: "band", label: "মেয়াদের ধাপ" },
          { key: "batches", label: "ব্যাচ", format: "qty" },
          { key: "qty", label: "মজুদ", format: "qty" },
          { key: "value", label: "মূল্য (পরিমাণ × ক্রয়মূল্য)", format: "money" },
          { key: "share", label: "অংশ" },
        ],
        rows,
        summary: [
          { label: "ইতিমধ্যে মেয়াদোত্তীর্ণ মজুদের মূল্য", value: formatMoney(expiredValue, cur), tone: expiredValue ? "red" : "green" },
          { label: "মেয়াদোত্তীর্ণ পরিমাণ", value: formatQty(round3(expired.reduce((s, r) => s + r.quantity, 0))), tone: expiredValue ? "red" : "green" },
          { label: "ব্যাচভিত্তিক মোট মজুদ মূল্য", value: formatMoney(total, cur), tone: "blue" },
        ],
        notes: [VALUE_NOTE],
        emptyMessage: "মজুদে কোনো ব্যাচ নেই",
      };
    },
  },
];

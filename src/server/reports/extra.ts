import "server-only";
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { VOUCHER_TYPES } from "@/lib/accounting";
import { formatDate, formatMoney, toDateInput } from "@/lib/format";
import { reportPeriod } from "../period";
import { AGING_BUCKETS, partyAging } from "../services/aging";
import { balancesBefore, listAccounts, statement } from "../services/ledger";
import { balanceSheet, trialBalance } from "../services/report";
import type { ReportDef, ReportParams, ReportResult, ReportRow } from "./types";
import type { AppContext } from "../auth";

const periodText = (from: string, to: string) => `${formatDate(from)} — ${formatDate(to)}`;
const asOfOf = (p: ReportParams) => (p.asOf && /^\d{4}-\d{2}-\d{2}$/.test(p.asOf) ? p.asOf : toDateInput());

// ───────────────────────── dues with aging ─────────────────────────

async function duesReport(ctx: AppContext, p: ReportParams, kind: "CUSTOMER" | "SUPPLIER"): Promise<ReportResult> {
  const asOf = asOfOf(p);
  const cur = ctx.business.currencySymbol;
  const q = p.q?.trim().toLowerCase();
  let rows = (await partyAging(ctx.business.id, kind, new Date(`${asOf}T00:00:00.000Z`))).filter((r) => r.balance !== 0);
  if (q) rows = rows.filter((r) => `${r.name} ${r.mobile ?? ""}`.toLowerCase().includes(q));
  if (p.type === "overdue") rows = rows.filter((r) => r.overdue > 0);
  rows.sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
  const base = kind === "CUSTOMER" ? "/customers" : "/suppliers";
  const tot = { balance: 0, overdue: 0, "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<string, number>;
  const out: ReportRow[] = rows.map((r) => {
    tot.balance += r.balance;
    tot.overdue += r.overdue;
    for (const b of AGING_BUCKETS) tot[b] += r.buckets[b];
    return {
      href: `${base}/${r.partyId}?tab=dues`,
      cells: {
        name: r.name, mobile: r.mobile, ...(kind === "CUSTOMER" ? { limit: r.creditLimit || null } : {}),
        "0-30": r.buckets["0-30"] || null, "31-60": r.buckets["31-60"] || null, "61-90": r.buckets["61-90"] || null, "90+": r.buckets["90+"] || null,
        overdue: r.overdue || null, balance: r.balance,
      },
    };
  });
  out.push({ kind: "total", cells: { name: "মোট", mobile: "", "0-30": round2(tot["0-30"]), "31-60": round2(tot["31-60"]), "61-90": round2(tot["61-90"]), "90+": round2(tot["90+"]), overdue: round2(tot.overdue), balance: round2(tot.balance) } });
  return {
    title: kind === "CUSTOMER" ? "কাস্টমার বাকি (বয়সভিত্তিক)" : "সরবরাহকারী দেনা (বয়সভিত্তিক)",
    subtitle: `${formatDate(asOf)} তারিখ পর্যন্ত`,
    columns: [
      { key: "name", label: "নাম" },
      { key: "mobile", label: "মোবাইল" },
      ...(kind === "CUSTOMER" ? [{ key: "limit", label: "ক্রেডিট সীমা", format: "money" as const }] : []),
      { key: "0-30", label: "০-৩০ দিন", format: "money" },
      { key: "31-60", label: "৩১-৬০ দিন", format: "money" },
      { key: "61-90", label: "৬১-৯০ দিন", format: "money" },
      { key: "90+", label: "৯০+ দিন", format: "money" },
      { key: "overdue", label: "মেয়াদোত্তীর্ণ", format: "money" },
      { key: "balance", label: kind === "CUSTOMER" ? "মোট বাকি" : "মোট দেনা", format: "money" },
    ],
    rows: out,
    summary: [
      { label: kind === "CUSTOMER" ? "মোট বাকি" : "মোট দেনা", value: formatMoney(tot.balance, cur), tone: "blue" },
      { label: "মেয়াদোত্তীর্ণ", value: formatMoney(tot.overdue, cur), tone: "red" },
      { label: "৯০+ দিন", value: formatMoney(tot["90+"], cur), tone: "red" },
      { label: "পার্টি", value: String(rows.length) },
    ],
    notes: ["পেমেন্ট ও ফেরত সবচেয়ে পুরনো ইনভয়েসের বিপরীতে (FIFO) সমন্বয় করে বয়স হিসাব করা হয়; বয়স ইনভয়েসের তারিখ থেকে, মেয়াদ = শেষ তারিখ বা ইনভয়েস তারিখ + পার্টির পরিশোধ মেয়াদ।"],
  };
}

// ───────────────────────── statements for parties ─────────────────────────

async function partyStatementReport(ctx: AppContext, p: ReportParams, kind: "CUSTOMER" | "SUPPLIER"): Promise<ReportResult> {
  const title = kind === "CUSTOMER" ? "কাস্টমার স্টেটমেন্ট" : "সরবরাহকারী স্টেটমেন্ট";
  const account = p.accountId ? await prisma.account.findFirst({ where: { id: p.accountId, businessId: ctx.business.id, kind } }) : null;
  if (!account) return { title, columns: [], rows: [], emptyMessage: `${kind === "CUSTOMER" ? "কাস্টমার" : "সরবরাহকারী"} নির্বাচন করুন` };
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const cur = ctx.business.currencySymbol;
  const st = await statement(ctx.business.id, [account.id], range);
  const rows: ReportRow[] = [
    { kind: "group", cells: { date: null, voucher: "", particulars: "প্রারম্ভিক ব্যালেন্স", debit: null, credit: null, balance: st.opening } },
    ...st.lines.map((l) => ({ href: `/vouchers/v/${l.voucherId}`, cells: { date: l.date, voucher: l.voucherNo, particulars: [VOUCHER_TYPES[l.voucherType].label, l.narration].filter(Boolean).join(" — "), debit: l.debit || null, credit: l.credit || null, balance: l.balance } })),
    { kind: "total", cells: { date: null, voucher: "", particulars: "সমাপনী", debit: st.totalDebit, credit: st.totalCredit, balance: st.closing } },
  ];
  return {
    title: `${title}: ${account.name}`,
    subtitle: periodText(from, to),
    columns: [
      { key: "date", label: "তারিখ", format: "date" }, { key: "voucher", label: "ভাউচার" }, { key: "particulars", label: "বিবরণ" },
      { key: "debit", label: "ডেবিট", format: "money" }, { key: "credit", label: "ক্রেডিট", format: "money" }, { key: "balance", label: "ব্যালেন্স", format: "drcr" },
    ],
    rows,
    summary: [{ label: "সমাপনী", value: formatMoney(Math.abs(st.closing), cur), tone: "blue" }],
  };
}

// ───────────────────────── registry entries ─────────────────────────

export const EXTRA_REPORTS: ReportDef[] = [
  { slug: "customer-dues", title: "কাস্টমার বাকি রিপোর্ট", description: "কাস্টমারভিত্তিক বাকি, মেয়াদোত্তীর্ণ ও বয়স বিশ্লেষণ (০-৩০/৩১-৬০/৬১-৯০/৯০+)", filters: ["asOf", "q", "dueStatus"], permission: "reports:view", run: (c, p) => duesReport(c, p, "CUSTOMER") },
  { slug: "supplier-dues", title: "সরবরাহকারী দেনা রিপোর্ট", description: "সরবরাহকারীভিত্তিক দেনা ও বয়স বিশ্লেষণ", filters: ["asOf", "q", "dueStatus"], permission: "reports:view", run: (c, p) => duesReport(c, p, "SUPPLIER") },
  { slug: "customer-statement", title: "কাস্টমার স্টেটমেন্ট", description: "নির্দিষ্ট কাস্টমারের হিসাব বিবরণী", filters: ["customer", "range"], permission: "reports:view", run: (c, p) => partyStatementReport(c, p, "CUSTOMER") },
  { slug: "supplier-statement", title: "সরবরাহকারী স্টেটমেন্ট", description: "নির্দিষ্ট সরবরাহকারীর হিসাব বিবরণী", filters: ["supplier", "range"], permission: "reports:view", run: (c, p) => partyStatementReport(c, p, "SUPPLIER") },
  {
    slug: "collection",
    title: "আদায় রিপোর্ট",
    description: "কাস্টমার থেকে আদায় — রিসিপ্ট ও বিক্রয়ের সময় পরিশোধ, মাধ্যমভিত্তিক",
    filters: ["range", "q"],
    permission: "reports:view",
    async run(ctx, p) {
      const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
      const cur = ctx.business.currencySymbol;
      const businessId = ctx.business.id;
      const [salePays, receipts] = await Promise.all([
        prisma.voucherPayment.findMany({
          where: { voucher: { businessId, type: "SALES", date: range } },
          include: { account: { select: { name: true } }, voucher: { select: { id: true, voucherNo: true, date: true, partyAccount: { select: { name: true } } } } },
        }),
        prisma.journalEntry.findMany({
          where: { businessId, date: range, credit: { gt: 0 }, account: { kind: "CUSTOMER" }, voucher: { type: "RECEIPT" } },
          include: { account: { select: { name: true } }, voucher: { select: { id: true, voucherNo: true, reference: true, cashAccount: { select: { name: true } } } } },
        }),
      ]);
      type Row = { date: Date; voucherId: string; voucherNo: string; party: string; method: string; ref: string; amount: number; kind: string };
      let list: Row[] = [
        ...salePays.map((x) => ({ date: x.voucher.date, voucherId: x.voucher.id, voucherNo: x.voucher.voucherNo, party: x.voucher.partyAccount?.name ?? "নগদ কাস্টমার", method: x.account.name, ref: x.reference ?? "", amount: num(x.amount), kind: "বিক্রয়ের সময়" })),
        ...receipts.map((e) => ({ date: e.date, voucherId: e.voucher.id, voucherNo: e.voucher.voucherNo, party: e.account.name, method: e.voucher.cashAccount?.name ?? "", ref: e.voucher.reference ?? "", amount: num(e.credit), kind: "বাকি আদায়" })),
      ];
      const q = p.q?.trim().toLowerCase();
      if (q) list = list.filter((r) => `${r.party} ${r.voucherNo} ${r.method} ${r.ref}`.toLowerCase().includes(q));
      list.sort((a, b) => a.date.getTime() - b.date.getTime());
      const byMethod = new Map<string, number>();
      for (const r of list) byMethod.set(r.method, round2((byMethod.get(r.method) ?? 0) + r.amount));
      const total = round2(list.reduce((s, r) => s + r.amount, 0));
      return {
        title: "আদায় রিপোর্ট",
        subtitle: periodText(from, to),
        columns: [
          { key: "date", label: "তারিখ", format: "date" }, { key: "voucher", label: "ভাউচার" }, { key: "party", label: "কাস্টমার" }, { key: "kind", label: "ধরন" },
          { key: "method", label: "মাধ্যম" }, { key: "ref", label: "রেফারেন্স" }, { key: "amount", label: "টাকা", format: "money" },
        ],
        rows: [
          ...list.map((r) => ({ href: `/vouchers/v/${r.voucherId}`, cells: { date: r.date, voucher: r.voucherNo, party: r.party, kind: r.kind, method: r.method, ref: r.ref, amount: r.amount } })),
          { kind: "total", cells: { date: null, voucher: "", party: "মোট আদায়", kind: "", method: "", ref: "", amount: total } },
        ],
        summary: [{ label: "মোট আদায়", value: formatMoney(total, cur), tone: "green" }, ...[...byMethod].slice(0, 3).map(([m, v]) => ({ label: m, value: formatMoney(v, cur) }))],
      };
    },
  },
  {
    slug: "expenses",
    title: "খরচ রিপোর্ট",
    description: "খাতভিত্তিক পরিচালন খরচের বিস্তারিত",
    filters: ["range", "q"],
    permission: "reports:view",
    async run(ctx, p) {
      const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
      const cur = ctx.business.currencySymbol;
      const accounts = await listAccounts(ctx.business.id, { nature: "EXPENSE", group: { isDirect: false } });
      const entries = await prisma.journalEntry.findMany({
        where: { businessId: ctx.business.id, date: range, accountId: { in: accounts.map((a) => a.id) } },
        orderBy: [{ date: "asc" }],
        include: { voucher: { select: { id: true, voucherNo: true, narration: true, type: true } } },
      });
      const q = p.q?.trim().toLowerCase();
      const rows: ReportRow[] = [];
      let total = 0;
      for (const a of accounts) {
        let list = entries.filter((e) => e.accountId === a.id);
        if (q) list = list.filter((e) => `${a.name} ${e.voucher.voucherNo} ${e.narration ?? ""} ${e.voucher.narration ?? ""}`.toLowerCase().includes(q));
        if (!list.length) continue;
        const sub = round2(list.reduce((s, e) => s + num(e.debit) - num(e.credit), 0));
        total = round2(total + sub);
        rows.push({ kind: "group", href: `/accounts/${a.id}`, cells: { date: null, voucher: "", particulars: a.name, amount: sub } });
        for (const e of list) rows.push({ indent: 1, href: `/vouchers/v/${e.voucher.id}`, cells: { date: e.date, voucher: e.voucher.voucherNo, particulars: e.narration ?? e.voucher.narration ?? VOUCHER_TYPES[e.voucher.type].label, amount: round2(num(e.debit) - num(e.credit)) } });
      }
      rows.push({ kind: "total", cells: { date: null, voucher: "", particulars: "মোট খরচ", amount: total } });
      return {
        title: "খরচ রিপোর্ট",
        subtitle: periodText(from, to),
        columns: [{ key: "particulars", label: "খাত / বিবরণ" }, { key: "date", label: "তারিখ", format: "date" }, { key: "voucher", label: "ভাউচার" }, { key: "amount", label: "টাকা", format: "money" }],
        rows,
        summary: [{ label: "মোট খরচ", value: formatMoney(total, cur), tone: "red" }],
      };
    },
  },
  {
    slug: "daily-summary",
    title: "দৈনিক ব্যবসা সারসংক্ষেপ",
    description: "প্রতিদিনের বিক্রয়, ক্রয়, আদায়, পরিশোধ, খরচ ও নগদ/ব্যাংক অবস্থা",
    filters: ["range"],
    permission: "reports:view",
    async run(ctx, p) {
      const defaults = p.from ? p : { ...p, from: toDateInput(new Date(Date.now() - 13 * 86_400_000)) };
      const { from, to, range } = reportPeriod(defaults, ctx.business.fiscalYearStartMonth);
      const cur = ctx.business.currencySymbol;
      const b = ctx.business.id;
      const [trade, ledger, cashOpen] = await Promise.all([
        prisma.$queryRaw<{ d: Date; type: string; amount: string }[]>`
          SELECT "date" AS d, "type"::text AS type, SUM("amount")::text AS amount FROM "Voucher"
          WHERE "businessId" = ${b} AND "date" >= ${range.gte} AND "date" < ${range.lt} AND "type" IN ('SALES','SALES_RETURN','PURCHASE','PURCHASE_RETURN')
          GROUP BY 1, 2`,
        prisma.$queryRaw<{ d: Date; bucket: string; amount: string }[]>`
          SELECT je."date" AS d,
            CASE
              WHEN a."kind" = 'CUSTOMER' AND je."credit" > 0 AND v."type" IN ('RECEIPT','SALES') THEN 'collection'
              WHEN a."kind" = 'SUPPLIER' AND je."debit" > 0 AND v."type" IN ('PAYMENT','PURCHASE') THEN 'paid'
              WHEN a."nature" = 'EXPENSE' AND g."isDirect" = false THEN 'expense'
              WHEN a."kind" IN ('CASH','BANK') THEN 'cash'
            END AS bucket,
            SUM(CASE WHEN a."kind" = 'CUSTOMER' THEN je."credit" WHEN a."kind" = 'SUPPLIER' THEN je."debit" ELSE je."debit" - je."credit" END)::text AS amount
          FROM "JournalEntry" je JOIN "Account" a ON a."id" = je."accountId" JOIN "AccountGroup" g ON g."id" = a."groupId" JOIN "Voucher" v ON v."id" = je."voucherId"
          WHERE je."businessId" = ${b} AND je."date" >= ${range.gte} AND je."date" < ${range.lt}
          GROUP BY 1, 2`,
        prisma.journalEntry.aggregate({ where: { businessId: b, date: { lt: range.gte }, account: { kind: { in: ["CASH", "BANK"] } } }, _sum: { debit: true, credit: true } }),
      ]);
      // walk-in sales are cash collections too
      const walkIn = await prisma.$queryRaw<{ d: Date; amount: string }[]>`
        SELECT "date" AS d, SUM("amount")::text AS amount FROM "Voucher"
        WHERE "businessId" = ${b} AND "type" = 'SALES' AND "partyAccountId" IS NULL AND "date" >= ${range.gte} AND "date" < ${range.lt} GROUP BY 1`;
      let cash = round2(num(cashOpen._sum.debit) - num(cashOpen._sum.credit));
      const rows: ReportRow[] = [];
      const t = { sales: 0, purchase: 0, collection: 0, paid: 0, expense: 0, net: 0 };
      for (let d = new Date(range.gte!); d < range.lt!; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        const same = (x: Date) => new Date(x).toISOString().slice(0, 10) === key;
        const tr = (type: string) => num(trade.find((x) => same(x.d) && x.type === type)?.amount);
        const lg = (bucket: string) => num(ledger.find((x) => same(x.d) && x.bucket === bucket)?.amount);
        const sales = round2(tr("SALES") - tr("SALES_RETURN"));
        const purchase = round2(tr("PURCHASE") - tr("PURCHASE_RETURN"));
        const collection = round2(lg("collection") + num(walkIn.find((x) => same(x.d))?.amount));
        const paid = lg("paid");
        const expense = lg("expense");
        const net = lg("cash");
        cash = round2(cash + net);
        t.sales += sales; t.purchase += purchase; t.collection += collection; t.paid += paid; t.expense += expense; t.net += net;
        rows.push({ href: `/reports/day-book?from=${key}&to=${key}`, cells: { date: new Date(`${key}T00:00:00Z`), sales: sales || null, purchase: purchase || null, collection: collection || null, paid: paid || null, expense: expense || null, net: net || null, cash } });
      }
      rows.push({ kind: "total", cells: { date: null, sales: round2(t.sales), purchase: round2(t.purchase), collection: round2(t.collection), paid: round2(t.paid), expense: round2(t.expense), net: round2(t.net), cash } });
      return {
        title: "দৈনিক ব্যবসা সারসংক্ষেপ",
        subtitle: periodText(from, to),
        columns: [
          { key: "date", label: "তারিখ", format: "date" }, { key: "sales", label: "নিট বিক্রয়", format: "money" }, { key: "purchase", label: "নিট ক্রয়", format: "money" },
          { key: "collection", label: "আদায়", format: "money" }, { key: "paid", label: "সরবরাহকারীকে পরিশোধ", format: "money" }, { key: "expense", label: "খরচ", format: "money" },
          { key: "net", label: "নগদ/ব্যাংক নিট", format: "money" }, { key: "cash", label: "দিনশেষে নগদ+ব্যাংক", format: "money" },
        ],
        rows,
        summary: [
          { label: "মোট বিক্রয়", value: formatMoney(t.sales, cur), tone: "blue" },
          { label: "মোট আদায়", value: formatMoney(t.collection, cur), tone: "green" },
          { label: "মোট খরচ", value: formatMoney(t.expense, cur), tone: "red" },
          { label: "সমাপনী নগদ+ব্যাংক", value: formatMoney(cash, cur) },
        ],
      };
    },
  },
  {
    slug: "cash-flow",
    title: "নগদ প্রবাহ বিবরণী",
    description: "পরিচালন, বিনিয়োগ ও অর্থায়ন কার্যক্রম থেকে নগদ ও ব্যাংকের আগমন-নির্গমন (প্রত্যক্ষ পদ্ধতি)",
    filters: ["range"],
    permission: "reports:view",
    async run(ctx, p) {
      const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
      const cur = ctx.business.currencySymbol;
      const b = ctx.business.id;
      const cashAccounts = await prisma.account.findMany({ where: { businessId: b, kind: { in: ["CASH", "BANK"] } }, select: { id: true } });
      const cashIds = new Set(cashAccounts.map((a) => a.id));
      const cashEntries = await prisma.journalEntry.findMany({ where: { businessId: b, date: range, accountId: { in: [...cashIds] } }, select: { voucherId: true, debit: true, credit: true } });
      const voucherIds = [...new Set(cashEntries.map((e) => e.voucherId))];
      const counter = voucherIds.length
        ? await prisma.journalEntry.findMany({ where: { voucherId: { in: voucherIds }, accountId: { notIn: [...cashIds] } }, select: { voucherId: true, debit: true, credit: true, account: { select: { kind: true, name: true, group: { select: { systemKey: true, name: true } } } } } })
        : [];
      const classify = (voucherId: string): { section: "operating" | "investing" | "financing" | "transfer"; label: string } => {
        const lines = counter.filter((c) => c.voucherId === voucherId);
        if (!lines.length) return { section: "transfer", label: "নগদ ↔ ব্যাংক স্থানান্তর" };
        const keys = lines.map((l) => l.account.group.systemKey);
        if (keys.includes("FIXED_ASSETS")) return { section: "investing", label: "স্থায়ী সম্পদ ক্রয়/বিক্রয়" };
        if (keys.includes("LOANS")) return { section: "financing", label: "ঋণ গ্রহণ/পরিশোধ" };
        if (keys.includes("CAPITAL")) return { section: "financing", label: "মূলধন / মালিকের উত্তোলন" };
        const main = lines.reduce((a, l) => (num(l.debit) + num(l.credit) > num(a.debit) + num(a.credit) ? l : a), lines[0]);
        const label = main.account.kind === "CUSTOMER" ? "কাস্টমার থেকে আদায়" : main.account.kind === "SUPPLIER" ? "সরবরাহকারীকে পরিশোধ" : main.account.group.name;
        return { section: "operating", label };
      };
      const buckets = new Map<string, { section: string; label: string; inflow: number; outflow: number }>();
      for (const e of cashEntries) {
        const c = classify(e.voucherId);
        if (c.section === "transfer") continue;
        const k = `${c.section}|${c.label}`;
        const bk = buckets.get(k) ?? { section: c.section, label: c.label, inflow: 0, outflow: 0 };
        bk.inflow += num(e.debit);
        bk.outflow += num(e.credit);
        buckets.set(k, bk);
      }
      const [openMap, closeMap] = await Promise.all([balancesBefore(b, range.gte, [...cashIds]), balancesBefore(b, range.lt, [...cashIds])]);
      const opening = round2([...openMap.values()].reduce((s, v) => s + v, 0));
      const closing = round2([...closeMap.values()].reduce((s, v) => s + v, 0));
      const rows: ReportRow[] = [{ kind: "subtotal", cells: { particulars: "প্রারম্ভিক নগদ ও ব্যাংক", inflow: null, outflow: null, net: opening } }];
      let netTotal = 0;
      for (const [section, title] of [["operating", "পরিচালন কার্যক্রম"], ["investing", "বিনিয়োগ কার্যক্রম"], ["financing", "অর্থায়ন কার্যক্রম"]] as const) {
        const list = [...buckets.values()].filter((x) => x.section === section);
        const inflow = round2(list.reduce((s, x) => s + x.inflow, 0));
        const outflow = round2(list.reduce((s, x) => s + x.outflow, 0));
        rows.push({ kind: "group", cells: { particulars: title, inflow: null, outflow: null, net: null } });
        for (const x of list) rows.push({ indent: 1, cells: { particulars: x.label, inflow: round2(x.inflow) || null, outflow: round2(x.outflow) || null, net: round2(x.inflow - x.outflow) } });
        rows.push({ kind: "subtotal", cells: { particulars: `${title} থেকে নিট নগদ`, inflow, outflow, net: round2(inflow - outflow) } });
        netTotal = round2(netTotal + inflow - outflow);
      }
      rows.push({ kind: "total", cells: { particulars: "নিট নগদ পরিবর্তন", inflow: null, outflow: null, net: netTotal } });
      rows.push({ kind: "total", cells: { particulars: "সমাপনী নগদ ও ব্যাংক", inflow: null, outflow: null, net: closing } });
      const ok = round2(opening + netTotal) === closing;
      return {
        title: "নগদ প্রবাহ বিবরণী",
        subtitle: periodText(from, to),
        columns: [{ key: "particulars", label: "বিবরণ" }, { key: "inflow", label: "আগমন", format: "money" }, { key: "outflow", label: "নির্গমন", format: "money" }, { key: "net", label: "নিট", format: "money" }],
        rows,
        summary: [
          { label: "প্রারম্ভিক", value: formatMoney(opening, cur) },
          { label: "নিট পরিবর্তন", value: formatMoney(netTotal, cur), tone: netTotal >= 0 ? "green" : "red" },
          { label: "সমাপনী", value: formatMoney(closing, cur), tone: "blue" },
          { label: "মিলিয়ে দেখা", value: ok ? "✔ প্রারম্ভিক + নিট = সমাপনী" : "✘ অমিল", tone: ok ? "green" : "red" },
        ],
      };
    },
  },
  {
    slug: "stock-valuation",
    title: "স্টক মূল্যায়ন",
    description: "ক্যাটাগরিভিত্তিক মজুদ পরিমাণ, গড় ক্রয়মূল্য, মজুদ মূল্য ও সম্ভাব্য বিক্রয়মূল্য",
    filters: ["q"],
    permission: "reports:view",
    async run(ctx, p) {
      const cur = ctx.business.currencySymbol;
      const q = p.q?.trim();
      const products = await prisma.product.findMany({
        where: { businessId: ctx.business.id, isActive: true, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
        include: { category: { select: { name: true } }, unit: { select: { name: true } } },
        orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
      });
      const groups = new Map<string, typeof products>();
      for (const pr of products) (groups.get(pr.category?.name ?? "ক্যাটাগরিহীন") ?? groups.set(pr.category?.name ?? "ক্যাটাগরিহীন", []).get(pr.category?.name ?? "ক্যাটাগরিহীন")!).push(pr);
      const rows: ReportRow[] = [];
      let tCost = 0, tRetail = 0;
      for (const [g, list] of groups) {
        let gc = 0, gr = 0;
        rows.push({ kind: "group", cells: { product: g, qty: null, rate: null, cost: null, price: null, retail: null, margin: null } });
        for (const pr of list) {
          const qty = num(pr.stock);
          const cost = round2(qty * num(pr.avgCost));
          const retail = round2(qty * num(pr.salePrice));
          gc += cost; gr += retail;
          rows.push({ indent: 1, href: `/products/${pr.id}`, cells: { product: `${pr.name} (${pr.unit.name})`, qty, rate: num(pr.avgCost), cost, price: num(pr.salePrice), retail, margin: round2(retail - cost) } });
        }
        rows.push({ kind: "subtotal", cells: { product: `${g} — মোট`, qty: null, rate: null, cost: round2(gc), price: null, retail: round2(gr), margin: round2(gr - gc) } });
        tCost += gc; tRetail += gr;
      }
      rows.push({ kind: "total", cells: { product: "সর্বমোট", qty: null, rate: null, cost: round2(tCost), price: null, retail: round2(tRetail), margin: round2(tRetail - tCost) } });
      const inv = await prisma.account.findFirst({ where: { businessId: ctx.business.id, systemKey: "INVENTORY" }, select: { id: true } });
      const ledger = inv ? (await balancesBefore(ctx.business.id, undefined, [inv.id])).get(inv.id) ?? 0 : 0;
      return {
        title: "স্টক মূল্যায়ন",
        subtitle: `${formatDate(new Date())} পর্যন্ত — মুভিং গড় ক্রয়মূল্যে`,
        columns: [
          { key: "product", label: "পণ্য" }, { key: "qty", label: "মজুদ", format: "qty" }, { key: "rate", label: "গড় ক্রয়মূল্য", format: "money" }, { key: "cost", label: "মজুদ মূল্য", format: "money" },
          { key: "price", label: "বিক্রয়মূল্য", format: "money" }, { key: "retail", label: "বিক্রয়মূল্যে মজুদ", format: "money" }, { key: "margin", label: "সম্ভাব্য মার্জিন", format: "money" },
        ],
        rows,
        summary: [
          { label: "মজুদ মূল্য (ক্রয়মূল্যে)", value: formatMoney(tCost, cur), tone: "blue" },
          { label: "মজুদ পণ্য লেজার", value: formatMoney(ledger, cur) },
          { label: "সম্ভাব্য মার্জিন", value: formatMoney(tRetail - tCost, cur), tone: "green" },
        ],
      };
    },
  },
  {
    slug: "integrity",
    title: "হিসাব যাচাই (ইন্টেগ্রিটি চেক)",
    description: "ডাবল-এন্ট্রি, স্টক, পার্টি ব্যালেন্স ও আর্থিক বিবরণীর স্বয়ংক্রিয় মিলিয়ে দেখা",
    filters: [],
    permission: "reports:view",
    async run(ctx) {
      const b = ctx.business.id;
      const cur = ctx.business.currencySymbol;
      const [unbalanced, tb, bs, inv, moveValue, stockMismatch, negative, payMismatch, custAging, custLedger] = await Promise.all([
        prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (SELECT "voucherId" FROM "JournalEntry" WHERE "businessId" = ${b} GROUP BY 1 HAVING SUM("debit") <> SUM("credit")) x`,
        trialBalance(b, {}),
        balanceSheet(b, new Date("2999-01-01")),
        prisma.account.findFirst({ where: { businessId: b, systemKey: "INVENTORY" }, select: { id: true } }),
        prisma.$queryRaw<{ v: string | null }[]>`SELECT SUM(("quantityIn" - "quantityOut") * "unitCost")::text AS v FROM "StockMovement" WHERE "businessId" = ${b}`,
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*) AS n FROM "Product" p
          LEFT JOIN (SELECT "productId", SUM("quantityIn" - "quantityOut") AS q FROM "StockMovement" WHERE "businessId" = ${b} GROUP BY 1) m ON m."productId" = p."id"
          WHERE p."businessId" = ${b} AND ABS(p."stock" - COALESCE(m.q, 0)) > 0.0005`,
        prisma.product.count({ where: { businessId: b, stock: { lt: 0 } } }),
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(*) AS n FROM "Voucher" v
          LEFT JOIN (SELECT "voucherId", SUM("amount") AS s FROM "VoucherPayment" GROUP BY 1) p ON p."voucherId" = v."id"
          WHERE v."businessId" = ${b} AND v."type" IN ('SALES','PURCHASE','SALES_RETURN','PURCHASE_RETURN') AND ABS(v."paidAmount" - COALESCE(p.s, 0)) > 0.005`,
        partyAging(b, "CUSTOMER", new Date("2999-01-01")),
        prisma.journalEntry.aggregate({ where: { businessId: b, account: { kind: "CUSTOMER" } }, _sum: { debit: true, credit: true } }),
      ]);
      const invLedger = inv ? (await balancesBefore(b, undefined, [inv.id])).get(inv.id) ?? 0 : 0;
      const agingTotal = round2(custAging.reduce((s, r) => s + r.balance, 0));
      const ledgerTotal = round2(num(custLedger._sum.debit) - num(custLedger._sum.credit));
      const checks: { name: string; detail: string; ok: boolean }[] = [
        { name: "প্রতিটি ভাউচারে ডেবিট = ক্রেডিট", detail: `অসমতাপূর্ণ ভাউচার: ${Number(unbalanced[0]?.n ?? 0)}`, ok: Number(unbalanced[0]?.n ?? 0) === 0 },
        { name: "ট্রায়াল ব্যালেন্স মিলেছে", detail: `ডেবিট ${formatMoney(tb.totals.closingDebit, cur)} / ক্রেডিট ${formatMoney(tb.totals.closingCredit, cur)}`, ok: tb.balanced },
        { name: "সম্পদ = দায় + মূলধন", detail: `পার্থক্য ${formatMoney(bs.difference, cur)}`, ok: bs.difference === 0 },
        { name: "মজুদ পণ্য লেজার = স্টক মুভমেন্ট মূল্য", detail: `${formatMoney(invLedger, cur)} বনাম ${formatMoney(num(moveValue[0]?.v), cur)}`, ok: Math.abs(invLedger - num(moveValue[0]?.v)) < 1 },
        { name: "পণ্যের স্টক = মুভমেন্টের যোগফল", detail: `অমিল পণ্য: ${Number(stockMismatch[0]?.n ?? 0)}`, ok: Number(stockMismatch[0]?.n ?? 0) === 0 },
        { name: "কোনো পণ্যের স্টক ঋণাত্মক নয়", detail: `ঋণাত্মক: ${negative}`, ok: negative === 0 },
        { name: "ইনভয়েসের পরিশোধ = পেমেন্ট লাইনের যোগফল", detail: `অমিল ভাউচার: ${Number(payMismatch[0]?.n ?? 0)}`, ok: Number(payMismatch[0]?.n ?? 0) === 0 },
        { name: "কাস্টমার বাকি (বয়স বিশ্লেষণ) = কাস্টমার লেজার", detail: `${formatMoney(agingTotal, cur)} বনাম ${formatMoney(ledgerTotal, cur)}`, ok: agingTotal === ledgerTotal },
      ];
      const passed = checks.filter((c) => c.ok).length;
      return {
        title: "হিসাব যাচাই",
        subtitle: `${formatDate(new Date())} — ${passed}/${checks.length} টি যাচাই সফল`,
        columns: [{ key: "check", label: "যাচাই" }, { key: "detail", label: "বিস্তারিত" }, { key: "status", label: "ফলাফল" }],
        rows: checks.map((c) => ({ cells: { check: c.name, detail: c.detail, status: c.ok ? "✔ ঠিক আছে" : "✘ সমস্যা" } })),
        summary: [{ label: "ফলাফল", value: passed === checks.length ? "✔ সব হিসাব মিলেছে" : `✘ ${checks.length - passed} টি সমস্যা`, tone: passed === checks.length ? "green" : "red" }],
      };
    },
  },
];



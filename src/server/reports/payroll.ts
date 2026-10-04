import "server-only";
// Payroll reports (permission payroll:view). Figures come from finalized (POSTED) payslips — drafts
// are not salary yet — and payments from the salary-payment records behind the payment vouchers.
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { round2 } from "@/lib/calc";
import { formatDate, formatMoney, toDateInput } from "@/lib/format";
import { COMPONENT_KIND_LABELS, parsePeriod, PAYROLL_KIND_LABELS, PAYSLIP_STATUS_LABELS, payslipStatus, periodKey, periodLabel, type PayComponentKind } from "@/lib/payroll";
import { reportPeriod } from "../period";
import { payableReconciliation, unpaidPayslips } from "../services/payroll";
import type { ReportDef, ReportParams, ReportRow } from "./types";

const thisPeriod = (p: ReportParams) => parsePeriod(p.period) ?? parsePeriod(toDateInput().slice(0, 7))!;
const NOTE_POSTED = "শুধু চূড়ান্ত (পোস্ট করা) বেতন দেখানো হয়েছে — খসড়া বেতন এখানে আসে না।";

function slipWhere(businessId: string, p: ReportParams, extra: Prisma.PayslipWhereInput = {}): Prisma.PayslipWhereInput {
  return {
    businessId,
    run: { status: "POSTED" },
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
    ...(p.departmentId ? { employee: { departmentId: p.departmentId } } : {}),
    ...extra,
  };
}

const sum = <T>(rows: T[], f: (r: T) => number) => round2(rows.reduce((s, r) => s + f(r), 0));

export const PAYROLL_REPORTS: ReportDef[] = [
  {
    slug: "payroll-monthly",
    title: "মাসিক বেতন রিপোর্ট",
    description: "মাসের প্রত্যেক কর্মচারীর মূল বেতন, ভাতা, ওভারটাইম, কর্তন, নিট ও পরিশোধ",
    filters: ["period", "department", "employee"],
    permission: "payroll:view",
    async run(ctx, p) {
      const { year, month } = thisPeriod(p);
      const cur = ctx.business.currencySymbol;
      const slips = await prisma.payslip.findMany({
        where: slipWhere(ctx.business.id, p, { year, month }),
        orderBy: [{ kind: "asc" }, { employeeCode: "asc" }],
        include: { lines: { select: { kind: true, amount: true, componentId: true, component: { select: { systemKey: true } } } } },
      });
      const rows: ReportRow[] = slips.map((s) => {
        const basic = sum(s.lines.filter((l) => l.component?.systemKey === "BASIC"), (l) => num(l.amount));
        const ot = sum(s.lines.filter((l) => l.component?.systemKey === "OVERTIME"), (l) => num(l.amount));
        const gross = num(s.gross);
        return {
          href: `/payroll/payslips/${s.id}`,
          cells: {
            employee: `${s.employeeCode} · ${s.employeeName}`, department: s.departmentName ?? "", kind: PAYROLL_KIND_LABELS[s.kind], days: s.kind === "REGULAR" ? num(s.payableDays) : null,
            basic, allowances: round2(gross - basic - ot), overtime: ot || null, gross, deductions: num(s.totalDeductions), net: num(s.net), paid: num(s.paidAmount),
            status: PAYSLIP_STATUS_LABELS[payslipStatus(num(s.net), num(s.paidAmount))],
          },
        };
      });
      const t = (k: string) => sum(rows, (r) => Number(r.cells[k] ?? 0));
      if (rows.length) rows.push({ kind: "total", cells: { employee: `মোট (${slips.length})`, department: "", kind: "", days: null, basic: t("basic"), allowances: t("allowances"), overtime: t("overtime"), gross: t("gross"), deductions: t("deductions"), net: t("net"), paid: t("paid"), status: "" } });
      return {
        title: "মাসিক বেতন রিপোর্ট",
        subtitle: periodLabel(year, month),
        columns: [
          { key: "employee", label: "কর্মচারী" }, { key: "department", label: "বিভাগ" }, { key: "kind", label: "ধরন" }, { key: "days", label: "বেতনযোগ্য দিন", format: "qty" },
          { key: "basic", label: "মূল বেতন", format: "money" }, { key: "allowances", label: "ভাতা", format: "money" }, { key: "overtime", label: "ওভারটাইম", format: "money" },
          { key: "gross", label: "মোট বেতন", format: "money" }, { key: "deductions", label: "কর্তন", format: "money" }, { key: "net", label: "নিট বেতন", format: "money" },
          { key: "paid", label: "পরিশোধিত", format: "money" }, { key: "status", label: "অবস্থা" },
        ],
        rows,
        summary: rows.length ? [
          { label: "মোট বেতন", value: formatMoney(t("gross"), cur), tone: "blue" },
          { label: "নিট বেতন", value: formatMoney(t("net"), cur) },
          { label: "পরিশোধিত", value: formatMoney(t("paid"), cur), tone: "green" },
          { label: "বাকি", value: formatMoney(round2(t("net") - t("paid")), cur), tone: "red" },
        ] : undefined,
        notes: [NOTE_POSTED],
        emptyMessage: `${periodLabel(year, month)} এর চূড়ান্ত বেতন নেই`,
      };
    },
  },
  {
    slug: "payroll-employee-history",
    title: "কর্মচারীর বেতন ইতিহাস",
    description: "একজন কর্মচারীর মাসভিত্তিক বেতন, কর্তন, নিট ও পরিশোধ",
    filters: ["employee", "range"],
    permission: "payroll:view",
    async run(ctx, p) {
      if (!p.employeeId) return { title: "কর্মচারীর বেতন ইতিহাস", columns: [], rows: [], emptyMessage: "রিপোর্ট দেখতে একজন কর্মচারী নির্বাচন করুন" };
      const e = await prisma.employee.findFirst({ where: { id: p.employeeId, businessId: ctx.business.id }, select: { code: true, name: true, designation: true } });
      if (!e) return { title: "কর্মচারীর বেতন ইতিহাস", columns: [], rows: [], emptyMessage: "কর্মচারী পাওয়া যায়নি" };
      const { from, to } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
      const fromKey = from.slice(0, 7);
      const toKey = to.slice(0, 7);
      const slips = (await prisma.payslip.findMany({ where: slipWhere(ctx.business.id, p), orderBy: [{ year: "asc" }, { month: "asc" }, { kind: "asc" }] }))
        .filter((s) => periodKey(s.year, s.month) >= fromKey && periodKey(s.year, s.month) <= toKey);
      const cur = ctx.business.currencySymbol;
      const rows: ReportRow[] = slips.map((s) => ({
        href: `/payroll/payslips/${s.id}`,
        cells: { month: periodLabel(s.year, s.month), kind: PAYROLL_KIND_LABELS[s.kind], basic: num(s.basicSalary), gross: num(s.gross), deductions: num(s.totalDeductions), net: num(s.net), paid: num(s.paidAmount), due: round2(num(s.net) - num(s.paidAmount)) },
      }));
      const t = (k: string) => sum(rows, (r) => Number(r.cells[k] ?? 0));
      if (rows.length) rows.push({ kind: "total", cells: { month: "মোট", kind: "", basic: null, gross: t("gross"), deductions: t("deductions"), net: t("net"), paid: t("paid"), due: t("due") } });
      return {
        title: "কর্মচারীর বেতন ইতিহাস",
        subtitle: `${e.code} · ${e.name}${e.designation ? ` (${e.designation})` : ""} · ${formatDate(from)} — ${formatDate(to)}`,
        columns: [
          { key: "month", label: "মাস" }, { key: "kind", label: "ধরন" }, { key: "basic", label: "মূল বেতন (মাসিক)", format: "money" }, { key: "gross", label: "মোট বেতন", format: "money" },
          { key: "deductions", label: "কর্তন", format: "money" }, { key: "net", label: "নিট বেতন", format: "money" }, { key: "paid", label: "পরিশোধিত", format: "money" }, { key: "due", label: "বাকি", format: "money" },
        ],
        rows,
        summary: rows.length ? [{ label: "মোট নিট বেতন", value: formatMoney(t("net"), cur), tone: "blue" }, { label: "পরিশোধিত", value: formatMoney(t("paid"), cur), tone: "green" }, { label: "বাকি", value: formatMoney(t("due"), cur), tone: "red" }] : undefined,
        notes: [NOTE_POSTED],
        emptyMessage: "এই সময়ে চূড়ান্ত বেতন নেই",
      };
    },
  },
  {
    slug: "payroll-payable",
    title: "বেতন প্রদেয় রিপোর্ট",
    description: "কর্মচারীভিত্তিক অপরিশোধিত বেতন ও \"বেতন প্রদেয়\" লেজারের সাথে মিল",
    filters: ["department", "employee"],
    permission: "payroll:view",
    async run(ctx, p) {
      const cur = ctx.business.currencySymbol;
      const [all, rec] = await Promise.all([unpaidPayslips(prisma, ctx.business.id, p.employeeId ? [p.employeeId] : undefined), payableReconciliation(ctx.business.id)]);
      let unpaid = all;
      if (p.departmentId) {
        const ids = new Set((await prisma.employee.findMany({ where: { businessId: ctx.business.id, departmentId: p.departmentId }, select: { id: true } })).map((e) => e.id));
        unpaid = unpaid.filter((s) => ids.has(s.employeeId));
      }
      const by = new Map<string, { name: string; months: string[]; due: number }>();
      for (const s of unpaid) {
        const x = by.get(s.employeeId) ?? { name: `${s.employeeCode} · ${s.employeeName}`, months: [], due: 0 };
        x.months.push(`${periodLabel(s.year, s.month)}${s.kind === "BONUS" ? " (উৎসব)" : ""}`);
        x.due = round2(x.due + s.due);
        by.set(s.employeeId, x);
      }
      const rows: ReportRow[] = [...by].sort((a, b) => b[1].due - a[1].due).map(([id, x]) => ({ href: `/payroll/employees/${id}`, cells: { employee: x.name, months: x.months.join(", "), due: x.due } }));
      const total = sum(rows, (r) => Number(r.cells.due));
      if (rows.length) rows.push({ kind: "total", cells: { employee: "মোট প্রদেয়", months: "", due: total } });
      const filtered = !!(p.employeeId || p.departmentId);
      return {
        title: "বেতন প্রদেয় রিপোর্ট",
        subtitle: `আজ পর্যন্ত (${formatDate(toDateInput())})`,
        columns: [{ key: "employee", label: "কর্মচারী" }, { key: "months", label: "অপরিশোধিত মাস" }, { key: "due", label: "প্রদেয় বেতন", format: "money" }],
        rows,
        summary: [
          { label: "মোট প্রদেয় (কর্মচারী)", value: formatMoney(filtered ? total : rec.employees, cur), tone: "red" },
          { label: "\"বেতন প্রদেয়\" লেজার", value: formatMoney(rec.ledgerBalance, cur), tone: "blue" },
          { label: "পার্থক্য", value: formatMoney(rec.difference, cur), tone: rec.difference === 0 ? "green" : "red" },
        ],
        notes: [
          rec.difference === 0 ? "✔ কর্মচারীভিত্তিক প্রদেয় ও লেজারের ব্যালেন্স মিলেছে।" : "✘ পার্থক্য আছে — \"বেতন প্রদেয়\" লেজারে বেতন মডিউলের বাইরে থেকে এন্ট্রি হয়েছে কিনা দেখুন।",
          ...(filtered ? ["ফিল্টার করা তালিকা; লেজারের সাথে মিল পুরো ব্যবসার জন্য দেখানো হয়েছে।"] : []),
        ],
        emptyMessage: "কোনো অপরিশোধিত বেতন নেই",
      };
    },
  },
  {
    slug: "payroll-payments",
    title: "বেতন পরিশোধ রিপোর্ট",
    description: "তারিখভিত্তিক বেতন পরিশোধ — কর্মচারী, মাস, মাধ্যম ও ভাউচার",
    filters: ["range", "department", "employee"],
    permission: "payroll:view",
    async run(ctx, p) {
      const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
      const cur = ctx.business.currencySymbol;
      const pays = await prisma.salaryPayment.findMany({
        where: { businessId: ctx.business.id, date: range, ...(p.employeeId ? { employeeId: p.employeeId } : {}), ...(p.departmentId ? { employee: { departmentId: p.departmentId } } : {}) },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        include: { payslip: { select: { year: true, month: true, kind: true, employeeCode: true, employeeName: true } }, voucher: { select: { id: true, voucherNo: true, cashAccount: { select: { name: true } } } } },
      });
      const rows: ReportRow[] = pays.map((x) => ({
        href: `/vouchers/v/${x.voucher.id}`,
        cells: { date: x.date, voucher: x.voucher.voucherNo, employee: `${x.payslip.employeeCode} · ${x.payslip.employeeName}`, month: `${periodLabel(x.payslip.year, x.payslip.month)}${x.payslip.kind === "BONUS" ? " (উৎসব)" : ""}`, method: x.voucher.cashAccount?.name ?? "", amount: num(x.amount) },
      }));
      const total = sum(rows, (r) => Number(r.cells.amount));
      if (rows.length) rows.push({ kind: "total", cells: { date: null, voucher: "", employee: "মোট পরিশোধ", month: "", method: "", amount: total } });
      return {
        title: "বেতন পরিশোধ রিপোর্ট",
        subtitle: `${formatDate(from)} — ${formatDate(to)}`,
        columns: [{ key: "date", label: "তারিখ", format: "date" }, { key: "voucher", label: "ভাউচার" }, { key: "employee", label: "কর্মচারী" }, { key: "month", label: "বেতনের মাস" }, { key: "method", label: "মাধ্যম" }, { key: "amount", label: "টাকা", format: "money" }],
        rows,
        summary: rows.length ? [{ label: "মোট পরিশোধ", value: formatMoney(total, cur), tone: "green" }] : undefined,
        emptyMessage: "এই সময়ে কোনো বেতন পরিশোধ হয়নি",
      };
    },
  },
  {
    slug: "payroll-department",
    title: "বিভাগভিত্তিক বেতন",
    description: "মাসের বেতন বিভাগ অনুযায়ী — কর্মচারী সংখ্যা, মোট, কর্তন, নিট ও প্রতিষ্ঠানের অবদান",
    filters: ["period"],
    permission: "payroll:view",
    async run(ctx, p) {
      const { year, month } = thisPeriod(p);
      const cur = ctx.business.currencySymbol;
      const slips = await prisma.payslip.findMany({ where: slipWhere(ctx.business.id, {}, { year, month }) });
      const by = new Map<string, { n: Set<string>; gross: number; ded: number; net: number; er: number }>();
      for (const s of slips) {
        const k = s.departmentName ?? "বিভাগহীন";
        const x = by.get(k) ?? { n: new Set(), gross: 0, ded: 0, net: 0, er: 0 };
        x.n.add(s.employeeId);
        x.gross = round2(x.gross + num(s.gross));
        x.ded = round2(x.ded + num(s.totalDeductions));
        x.net = round2(x.net + num(s.net));
        x.er = round2(x.er + num(s.employerCost));
        by.set(k, x);
      }
      const rows: ReportRow[] = [...by].sort((a, b) => b[1].gross - a[1].gross).map(([d, x]) => ({ cells: { department: d, employees: x.n.size, gross: x.gross, deductions: x.ded, net: x.net, employer: x.er || null, cost: round2(x.gross + x.er) } }));
      const t = (k: string) => sum(rows, (r) => Number(r.cells[k] ?? 0));
      if (rows.length) rows.push({ kind: "total", cells: { department: "মোট", employees: t("employees"), gross: t("gross"), deductions: t("deductions"), net: t("net"), employer: t("employer"), cost: t("cost") } });
      return {
        title: "বিভাগভিত্তিক বেতন",
        subtitle: periodLabel(year, month),
        columns: [
          { key: "department", label: "বিভাগ" }, { key: "employees", label: "কর্মচারী", format: "qty" }, { key: "gross", label: "মোট বেতন", format: "money" }, { key: "deductions", label: "কর্তন", format: "money" },
          { key: "net", label: "নিট বেতন", format: "money" }, { key: "employer", label: "প্রতিষ্ঠানের অবদান", format: "money" }, { key: "cost", label: "মোট ব্যয়", format: "money" },
        ],
        rows,
        summary: rows.length ? [{ label: "মোট বেতন ব্যয়", value: formatMoney(t("cost"), cur), tone: "blue" }, { label: "নিট বেতন", value: formatMoney(t("net"), cur) }] : undefined,
        notes: [NOTE_POSTED],
        emptyMessage: `${periodLabel(year, month)} এর চূড়ান্ত বেতন নেই`,
      };
    },
  },
  {
    slug: "payroll-components",
    title: "ভাতা ও কর্তন রিপোর্ট",
    description: "মাসের প্রতিটি বেতন উপাদানের (ভাতা, ওভারটাইম, কর্তন, অবদান) মোট",
    filters: ["period", "department", "employee"],
    permission: "payroll:view",
    async run(ctx, p) {
      const { year, month } = thisPeriod(p);
      const cur = ctx.business.currencySymbol;
      const lines = await prisma.payslipLine.findMany({
        where: { payslip: slipWhere(ctx.business.id, p, { year, month }) },
        select: { kind: true, name: true, amount: true, componentId: true, component: { select: { name: true } }, payslip: { select: { employeeId: true } } },
      });
      const rows: ReportRow[] = [];
      const totals: Record<string, number> = {};
      for (const kind of ["EARNING", "DEDUCTION", "EMPLOYER"] as PayComponentKind[]) {
        const mine = lines.filter((l) => l.kind === kind);
        if (!mine.length) continue;
        const by = new Map<string, { n: Set<string>; amount: number }>();
        for (const l of mine) {
          const k = l.component?.name ?? l.name; // overtime / absence lines carry hours in their name
          const x = by.get(k) ?? { n: new Set(), amount: 0 };
          x.n.add(l.payslip.employeeId);
          x.amount = round2(x.amount + num(l.amount));
          by.set(k, x);
        }
        totals[kind] = sum([...by.values()], (x) => x.amount);
        rows.push({ kind: "group", cells: { component: COMPONENT_KIND_LABELS[kind], employees: null, amount: totals[kind] } });
        for (const [k, x] of [...by].sort((a, b) => b[1].amount - a[1].amount)) rows.push({ indent: 1, cells: { component: k, employees: x.n.size, amount: x.amount } });
      }
      return {
        title: "ভাতা ও কর্তন রিপোর্ট",
        subtitle: periodLabel(year, month),
        columns: [{ key: "component", label: "উপাদান" }, { key: "employees", label: "কর্মচারী", format: "qty" }, { key: "amount", label: "টাকা", format: "money" }],
        rows,
        summary: rows.length ? [
          { label: "মোট আয়/ভাতা", value: formatMoney(totals.EARNING ?? 0, cur), tone: "blue" },
          { label: "মোট কর্তন", value: formatMoney(totals.DEDUCTION ?? 0, cur), tone: "red" },
          { label: "নিট", value: formatMoney(round2((totals.EARNING ?? 0) - (totals.DEDUCTION ?? 0)), cur), tone: "green" },
        ] : undefined,
        notes: [NOTE_POSTED],
        emptyMessage: `${periodLabel(year, month)} এর চূড়ান্ত বেতন নেই`,
      };
    },
  },
];

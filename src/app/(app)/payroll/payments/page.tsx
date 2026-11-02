import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatDate, formatDateTime, formatMoney, toBnDigits } from "@/lib/format";
import { periodLabel } from "@/lib/payroll";
import { ActionButton } from "@/components/forms";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { SearchSelectField } from "@/components/search-select";
import { can } from "@/server/auth";
import { requirePayroll } from "@/server/payroll-context";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { reportPeriod } from "@/server/period";
import { deleteSalaryPaymentAction } from "@/server/actions/payroll";
import { searchEmployees } from "@/server/lookup";

import { BankSalaryAdviceDialog } from "./bank-advice-dialog";

export const metadata: Metadata = { title: "বেতন পরিশোধ ও ফান্ড ট্রান্সফার" };

export default async function SalaryPaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePayroll("payroll:view");
  const p = await readParams(searchParams);
  const biz = ctx.business.id;
  const cur = ctx.business.currencySymbol;
  const currentTab = (p as any).tab === "transfers" ? "transfers" : "vouchers";
  const { from, to, range } = reportPeriod(p, ctx.business.fiscalYearStartMonth);
  const page = pageOf(p);

  const voucherWhere = {
    businessId: biz,
    sourceKey: { startsWith: "payroll:payment:" },
    date: range,
    ...(p.employeeId ? { salaryPayments: { some: { employeeId: p.employeeId } } } : {}),
  };

  const transferWhere = {
    businessId: biz,
    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
  };

  const [vouchers, voucherTotal, transferLogs, transferTotal, picked, bankAccounts, settings] = await Promise.all([
    currentTab === "vouchers"
      ? prisma.voucher.findMany({
          where: voucherWhere,
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          skip: page.skip,
          take: page.take,
          include: {
            cashAccount: { select: { name: true } },
            salaryPayments: {
              include: {
                payslip: {
                  select: { employeeCode: true, employeeName: true, year: true, month: true },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.voucher.count({ where: voucherWhere }),
    currentTab === "transfers"
      ? prisma.bankTransferLog.findMany({
          where: transferWhere,
          orderBy: { createdAt: "desc" },
          skip: page.skip,
          take: page.take,
          include: {
            employee: { select: { id: true, code: true, name: true, designation: true } },
            account: { select: { id: true, name: true, bankName: true } },
            voucher: { select: { id: true, voucherNo: true } },
          },
        })
      : Promise.resolve([]),
    prisma.bankTransferLog.count({ where: transferWhere }),
    p.employeeId ? searchEmployees(biz, "", { ids: [p.employeeId] }) : Promise.resolve([]),
    prisma.account.findMany({
      where: { businessId: biz, kind: { in: ["BANK", "CASH"] }, isActive: true },
      select: { id: true, name: true, bankName: true, accountNumber: true, isApiEnabled: true, apiProvider: true },
      orderBy: { name: "asc" },
    }),
    prisma.payrollSettings.findUnique({
      where: { businessId: biz },
      select: { disbursementAccountId: true, isBankApiEnabled: true, bankApiProvider: true },
    }),
  ]);

  const pay = can(ctx, "payroll:pay");
  const now = new Date();

  return (
    <>
      <PageHeader
        title="বেতন পরিশোধ"
        description="ডুয়েল-মেথড পেরোল: ব্যাংক অ্যাডভাইস ডাউনলোড বা সরাসরি ব্যাংক API ফান্ড ট্রান্সফার"
        crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "বেতন পরিশোধ" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BankSalaryAdviceDialog
              bankAccounts={bankAccounts}
              defaultBankAccountId={settings?.disbursementAccountId}
              currentYear={now.getFullYear()}
              currentMonth={now.getMonth() + 1}
            />
            {pay && (
              <Link prefetch={false} href="/payroll/payments/new" className="btn-primary">
                + বেতন পরিশোধ
              </Link>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-rule mb-4">
        <Link
          href={`/payroll/payments?tab=vouchers${p.from ? `&from=${p.from}` : ""}${p.to ? `&to=${p.to}` : ""}`}
          className={`py-2.5 px-4 text-sm font-semibold border-b-2 -mb-px flex items-center gap-2 transition-colors ${
            currentTab === "vouchers"
              ? "border-brand-600 text-brand-600 font-bold"
              : "border-transparent text-slate-500 hover:text-ink-900"
          }`}
        >
          <span>📋</span>
          <span>বেতন পরিশোধ ভাউচার ({toBnDigits(voucherTotal)})</span>
        </Link>
        <Link
          href={`/payroll/payments?tab=transfers${p.from ? `&from=${p.from}` : ""}${p.to ? `&to=${p.to}` : ""}`}
          className={`py-2.5 px-4 text-sm font-semibold border-b-2 -mb-px flex items-center gap-2 transition-colors ${
            currentTab === "transfers"
              ? "border-brand-600 text-brand-600 font-bold"
              : "border-transparent text-slate-500 hover:text-ink-900"
          }`}
        >
          <span>⚡</span>
          <span>সরাসরি ব্যাংক API ট্রান্সফার লগ ({toBnDigits(transferTotal)})</span>
        </Link>
      </div>

      <section className="panel">
        <FilterBar action="/payroll/payments">
          <input type="hidden" name="tab" value={currentTab} />
          <FilterField label="শুরু"><input type="date" name="from" defaultValue={from} className="input w-40" /></FilterField>
          <FilterField label="শেষ"><input type="date" name="to" defaultValue={to} className="input w-40" /></FilterField>
          <FilterField label="কর্মচারী"><SearchSelectField kind="employees" name="employeeId" id="filter-employee" initial={picked[0] ?? null} noneLabel="সব কর্মচারী" className="w-60" /></FilterField>
        </FilterBar>

        {/* TAB 1: PAYMENT VOUCHERS */}
        {currentTab === "vouchers" && (
          <>
            {vouchers.length === 0 ? (
              <EmptyState message="এই সময়ে কোনো বেতন পরিশোধ ভাউচার নেই" />
            ) : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>তারিখ</th><th>ভাউচার</th><th>কর্মচারী (বেতনের মাস)</th><th>মাধ্যম</th><th className="text-right">টাকা</th><th /></tr></thead>
                  <tbody>
                    {vouchers.map((v) => {
                      const byEmp = new Map<string, string[]>();
                      for (const x of v.salaryPayments) {
                        const k = `${x.payslip.employeeCode} ${x.payslip.employeeName}`;
                        byEmp.set(k, [...(byEmp.get(k) ?? []), `${periodLabel(x.payslip.year, x.payslip.month)}: ${formatMoney(num(x.amount), cur)}`]);
                      }
                      return (
                        <tr key={v.id}>
                          <td>{formatDate(v.date)}</td>
                          <td><Link prefetch={false} href={`/vouchers/v/${v.id}`} className="font-mono text-xs hover:underline">{v.voucherNo}</Link>{v.reference && <span className="block text-xs text-slate-400">{v.reference}</span>}</td>
                          <td className="text-sm">
                            {[...byEmp].slice(0, 4).map(([k, months]) => <span key={k} className="block">{k} <span className="text-xs text-slate-500">({months.join(", ")})</span></span>)}
                            {byEmp.size > 4 && <span className="text-xs text-slate-500">আরও {toBnDigits(byEmp.size - 4)} জন</span>}
                          </td>
                          <td className="text-sm">{v.cashAccount?.name}</td>
                          <td className="num font-semibold">{formatMoney(num(v.amount), cur)}</td>
                          <td>{pay && <ActionButton action={deleteSalaryPaymentAction.bind(null, v.id)} label="বাতিল" className="btn-ghost btn-sm text-credit" confirmText="এই বেতন পরিশোধ বাতিল হবে (ভাউচার মুছে যাবে, বেতন আবার প্রদেয় হবে)। নিশ্চিত?" />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <Pagination basePath="/payroll/payments" params={{ ...p, tab: "vouchers" }} page={page.page} totalPages={totalPages(voucherTotal)} total={voucherTotal} />
          </>
        )}

        {/* TAB 2: BANK API TRANSFER HISTORY & AUDIT TRAIL */}
        {currentTab === "transfers" && (
          <>
            {transferLogs.length === 0 ? (
              <EmptyState message="কোনো সরাসরি ব্যাংক API ট্রান্সফার হিস্ট্রি পাওয়া যায়নি" />
            ) : (
              <TableWrap>
                <table className="table">
                  <thead>
                    <tr>
                      <th>তারিখ ও সময়</th>
                      <th>কর্মচারী</th>
                      <th>ব্যাংক ও হিসাব নম্বর</th>
                      <th>রাউটিং কোড</th>
                      <th className="text-right">পরিমাণ</th>
                      <th>ব্যাংক Trx ID / UTR</th>
                      <th>অবস্থা</th>
                      <th>ভাউচার</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transferLogs.map((t) => (
                      <tr key={t.id}>
                        <td className="text-xs text-slate-600">
                          {formatDateTime(t.createdAt)}
                        </td>
                        <td>
                          <span className="font-semibold text-ink-900 block">{t.employee.name}</span>
                          <span className="text-xs text-slate-400 font-mono">{t.employee.code}</span>
                        </td>
                        <td className="text-xs">
                          <span className="font-medium text-ink-900 block">{t.bankName || "—"}</span>
                          <span className="font-mono text-slate-500">A/C: {t.accountNumber}</span>
                        </td>
                        <td className="font-mono text-xs text-slate-600">
                          {t.routingNumber || "—"}
                        </td>
                        <td className="num font-semibold text-ink-900">
                          {formatMoney(num(t.amount), cur)}
                        </td>
                        <td className="text-xs font-mono">
                          {t.bankTxId ? (
                            <span className="text-brand-800 font-bold block">{t.bankTxId}</span>
                          ) : (
                            <span className="text-slate-400 block">—</span>
                          )}
                          {t.utrNumber && <span className="text-[11px] text-slate-500">UTR: {t.utrNumber}</span>}
                        </td>
                        <td>
                          {t.status === "SUCCESS" && (
                            <Badge tone="green">✓ সফল</Badge>
                          )}
                          {t.status === "FAILED" && (
                            <span title={t.errorMessage || "ব্যর্থ"}>
                              <Badge tone="red">✗ ব্যর্থ</Badge>
                              {t.errorMessage && (
                                <span className="block text-[10px] text-rose-600 max-w-xs truncate">
                                  {t.errorMessage}
                                </span>
                              )}
                            </span>
                          )}
                          {t.status === "PENDING" && (
                            <Badge tone="amber">প্রক্রিয়াধীন</Badge>
                          )}
                        </td>
                        <td>
                          {t.voucher ? (
                            <Link
                              prefetch={false}
                              href={`/vouchers/v/${t.voucher.id}`}
                              className="font-mono text-xs hover:underline text-brand-600 font-bold"
                            >
                              {t.voucher.voucherNo}
                            </Link>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
            <Pagination basePath="/payroll/payments" params={{ ...p, tab: "transfers" }} page={page.page} totalPages={totalPages(transferTotal)} total={transferTotal} />
          </>
        )}
      </section>
    </>
  );
}

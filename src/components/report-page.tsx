import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { featureForPath } from "@/lib/features";
import { prisma } from "@/lib/db";
import { toDateInput } from "@/lib/format";
import { VOUCHER_TYPES, type VoucherTypeKey } from "@/lib/accounting";
import { can, requirePermission } from "@/server/auth";
import { reportPeriod } from "@/server/period";
import { findReport, reportOpenFor } from "@/server/reports/registry";
import type { ReportParams } from "@/server/reports/types";
import { searchAccounts, searchEmployees, searchParties } from "@/server/lookup";
import { SearchableAccountField } from "./account-select";
import { PrintButton } from "./forms";
import { SearchSelectField } from "./search-select";
import { ReportNotes, ReportSummary, ReportTable } from "./report-view";
import { buildQuery, FilterField, PageHeader, PrintHeader } from "./ui";
import { accountScopeWhere } from "@/server/party-scope";

/** Renders any registered report: filters (GET), summary, ruled table, print & CSV export. */
export async function ReportPage({
  slug,
  params,
  basePath,
  crumbs,
  title,
  description,
  extraActions,
  omitFilters = [],
  before,
}: {
  slug: string;
  params: ReportParams;
  basePath?: string;
  crumbs?: { label: string; href?: string }[];
  title?: string;
  description?: string;
  extraActions?: React.ReactNode;
  omitFilters?: string[];
  before?: React.ReactNode;
}) {
  const def = findReport(slug);
  if (!def) notFound();
  const ctx = await requirePermission(def.permission);
  if (!reportOpenFor(ctx, slug)) redirect("/forbidden"); // assigned-only roles: business-wide books list every party
  const report = await def.run(ctx, params);
  const path = basePath ?? `/reports/${slug}`;
  const { from, to } = reportPeriod(params, ctx.business.fiscalYearStartMonth);
  const f = new Set(def.filters.filter((x) => !omitFilters.includes(x) && (x !== "warehouse" || ctx.features.includes("MULTI_WAREHOUSE"))));
  // the app layout already refuses reports of switched-off features; checked here too
  const gate = featureForPath(`/reports/${slug}`);
  if (gate && !ctx.features.includes(gate)) redirect(`/forbidden?feature=${gate}`);
  const keep = omitFilters.includes("account") && params.accountId ? <input type="hidden" name="accountId" value={params.accountId} /> : null;

  // account filters load only the selected ledger; the picker searches the rest
  const accountFilter = f.has("account") || f.has("cashAccount") || f.has("bankAccount");
  const [picked, warehouses, parties, departments, employee] = await Promise.all([
    accountFilter && params.accountId ? searchAccounts(ctx.business.id, "", { ids: [params.accountId], where: accountScopeWhere(ctx) }).then((r) => r.items) : [],
    f.has("warehouse") ? prisma.warehouse.findMany({ where: { businessId: ctx.business.id }, select: { id: true, name: true } }) : [],
    // only the selected party is loaded; the picker searches the rest
    (f.has("customer") || f.has("supplier")) && params.accountId
      ? searchParties(ctx.business.id, f.has("customer") ? "CUSTOMER" : "SUPPLIER", "", { accountIds: [params.accountId], allowed: f.has("customer") ? ctx.partyScope.customers : ctx.partyScope.suppliers })
      : [],
    f.has("department") ? prisma.department.findMany({ where: { businessId: ctx.business.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    f.has("employee") && params.employeeId ? searchEmployees(ctx.business.id, "", { ids: [params.employeeId] }).then((r) => r[0] ?? null) : null,
  ]);
  const exportHref = `/api/reports/${slug}${buildQuery(params)}`;

  return (
    <>
      {/* the printed sheet has its own heading (PrintHeader below) */}
      <div className="no-print">
      <PageHeader
        title={title ?? def.title}
        description={description ?? def.description}
        crumbs={crumbs ?? [{ label: "রিপোর্ট", href: can(ctx, "reports:view") ? "/reports" : undefined }, { label: def.title }]}
        actions={
          <>
            {extraActions}
            {report.rows.length > 0 && (
              <>
                <PrintButton label="প্রিন্ট / PDF" />
                <a href={`${exportHref}${exportHref.includes("?") ? "&" : "?"}format=xlsx`} className="btn-secondary">⬇ Excel (XLSX)</a>
                <a href={exportHref} className="btn-secondary">⬇ CSV</a>
              </>
            )}
          </>
        }
      />
      </div>
      {before}
      <section className="panel print-area">
        <form method="get" action={path} className="no-print flex flex-wrap items-end gap-2 border-b border-rule p-3">
          {keep}
          {f.has("account") && (
            <FilterField label="হিসাব (লেজার)">
              <SearchableAccountField name="accountId" id="filter-account" scope="all" initial={picked[0] ?? null} placeholder="— নির্বাচন করুন —" allowCreate={false} currency={ctx.business.currencySymbol} className="w-64" />
            </FilterField>
          )}
          {(f.has("cashAccount") || f.has("bankAccount")) && (
            <FilterField label="হিসাব">
              <SearchableAccountField name="accountId" id="filter-cash-account" scope={f.has("cashAccount") ? (f.has("bankAccount") ? "cash" : "cash-in-hand") : "bank"} initial={picked[0] ?? null} noneLabel="সব" allowCreate={false} currency={ctx.business.currencySymbol} className="w-56" />
            </FilterField>
          )}
          {(f.has("customer") || f.has("supplier")) && (
            <FilterField label={f.has("customer") ? "কাস্টমার" : "সরবরাহকারী"}>
              <SearchSelectField kind={f.has("customer") ? "customers" : "suppliers"} name="accountId" id="filter-party" initial={parties[0] ?? null} noneLabel="— নির্বাচন করুন —" currency={ctx.business.currencySymbol} className="w-60" />
            </FilterField>
          )}
          {f.has("dueStatus") && (
            <FilterField label="অবস্থা">
              <select name="type" defaultValue={params.type ?? ""} className="input w-40">
                <option value="">সব বাকি</option>
                <option value="overdue">শুধু মেয়াদোত্তীর্ণ</option>
              </select>
            </FilterField>
          )}
          {f.has("period") && (
            <FilterField label="মাস">
              <input type="month" name="period" defaultValue={params.period ?? toDateInput().slice(0, 7)} className="input w-40" />
            </FilterField>
          )}
          {f.has("department") && (
            <FilterField label="বিভাগ">
              <select name="departmentId" defaultValue={params.departmentId ?? ""} className="input w-40">
                <option value="">সব বিভাগ</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </FilterField>
          )}
          {f.has("employee") && (
            <FilterField label="কর্মচারী">
              <SearchSelectField kind="employees" name="employeeId" id="filter-employee" initial={employee} noneLabel="সব কর্মচারী" className="w-60" />
            </FilterField>
          )}
          {f.has("range") && (
            <>
              <FilterField label="শুরু">
                <input type="date" name="from" defaultValue={from} className="input w-40" />
              </FilterField>
              <FilterField label="শেষ">
                <input type="date" name="to" defaultValue={to} className="input w-40" />
              </FilterField>
            </>
          )}
          {f.has("asOf") && (
            <FilterField label="তারিখ পর্যন্ত">
              <input type="date" name="asOf" defaultValue={params.asOf ?? to} className="input w-40" />
            </FilterField>
          )}
          {f.has("voucherType") && (
            <FilterField label="ভাউচারের ধরন">
              <select name="type" defaultValue={params.type ?? ""} className="input w-40">
                <option value="">সব</option>
                {(Object.keys(VOUCHER_TYPES) as VoucherTypeKey[]).map((t) => <option key={t} value={t}>{VOUCHER_TYPES[t].label}</option>)}
              </select>
            </FilterField>
          )}
          {f.has("warehouse") && (
            <FilterField label="গুদাম">
              <select name="warehouseId" defaultValue={params.warehouseId ?? ""} className="input w-40">
                <option value="">সব গুদাম</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </FilterField>
          )}
          {f.has("q") && (
            <FilterField label="খুঁজুন">
              <input name="q" defaultValue={params.q} placeholder="নাম, নম্বর, বিবরণ…" className="input w-52" />
            </FilterField>
          )}
          <button type="submit" className="btn-primary">দেখুন</button>
          <Link prefetch={false} href={path} className="btn-ghost">রিসেট</Link>
        </form>
        {/* Ledger and statement views: omit redundant in-page header and summary strip; keep clean table */}
        {slug === "ledger" || slug.endsWith("-ledger") || slug.endsWith("-statement") || slug.endsWith("-book") || Boolean(before) ? (
          <>
            <div className="print-only px-4 pt-3">
              <PrintHeader business={ctx.business} title={report.title} subtitle={report.subtitle} />
            </div>
            <ReportTable report={report} currency={ctx.business.currencySymbol} />
            <ReportNotes report={report} />
          </>
        ) : (
          <>
            <div className="px-4 pt-3">
              <PrintHeader business={ctx.business} title={report.title} subtitle={report.subtitle} />
              <div className="no-print pb-2">
                <h2 className="text-base font-semibold text-ink-900">{report.title}</h2>
                {report.subtitle && <p className="text-xs text-slate-500">{report.subtitle}</p>}
              </div>
            </div>
            <ReportSummary report={report} />
            <ReportTable report={report} currency={ctx.business.currencySymbol} />
            <ReportNotes report={report} />
          </>
        )}
      </section>
    </>
  );
}

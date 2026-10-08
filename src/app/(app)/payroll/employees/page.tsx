import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma, num } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/format";
import { EMPLOYMENT_STATUS_LABELS } from "@/lib/payroll";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { can } from "@/server/auth";
import { requirePayroll } from "@/server/payroll-context";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";
import { employeePayables } from "@/server/services/payroll";
import { ci } from "@/lib/dialect";

export const metadata: Metadata = { title: "কর্মচারী" };

/** Bangla or ASCII digits of a query, ASCII only */
const digitsOf = (s: string) => s.replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d))).replace(/D/g, "");

const STATUS_TONE: Record<string, "green" | "amber" | "blue" | "slate" | "red"> = { ACTIVE: "green", PROBATION: "blue", ON_LEAVE: "amber", RESIGNED: "slate", TERMINATED: "red" };

export default async function EmployeesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePayroll("payroll:view");
  const p = await readParams(searchParams);
  const biz = ctx.business.id;
  const cur = ctx.business.currencySymbol;
  const q = p.q?.trim();
  const status = p.status ?? "current";
  const where: Prisma.EmployeeWhereInput = {
    businessId: biz,
    ...(status === "current" ? { status: { in: ["ACTIVE", "PROBATION", "ON_LEAVE"] } } : status !== "all" && EMPLOYMENT_STATUS_LABELS[status] ? { status: status as never } : {}),
    ...(p.departmentId ? { departmentId: p.departmentId } : {}),
    ...(q
      ? { OR: [{ name: ci(q) }, { code: ci(q) }, { designation: ci(q) }, ...(digitsOf(q).length >= 3 ? [{ mobile: { contains: digitsOf(q) } }, { nid: { contains: digitsOf(q) } }] : [])] }
      : {}),
  };
  const page = pageOf(p);
  const [rows, total, departments] = await Promise.all([
    prisma.employee.findMany({ where, include: { department: { select: { name: true } } }, orderBy: [{ code: "asc" }], skip: page.skip, take: page.take }),
    prisma.employee.count({ where }),
    prisma.department.findMany({ where: { businessId: biz }, orderBy: { name: "asc" } }),
  ]);
  const payable = await employeePayables(biz, rows.map((r) => r.id));

  return (
    <>
      <PageHeader
        title="কর্মচারী"
        description="কর্মচারীর তথ্য, বিভাগ, পদবি ও বেতন কাঠামো"
        crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "কর্মচারী" }]}
        actions={can(ctx, "payroll:manage") ? <Link prefetch={false} href="/payroll/employees/new" className="btn-primary">+ নতুন কর্মচারী</Link> : undefined}
      />
      <section className="panel">
        <FilterBar action="/payroll/employees">
          <FilterField label="খুঁজুন"><input name="q" defaultValue={q ?? ""} placeholder="নাম, আইডি, মোবাইল, NID, পদবি" className="input w-56" /></FilterField>
          <FilterField label="বিভাগ">
            <select name="departmentId" defaultValue={p.departmentId ?? ""} className="input w-40">
              <option value="">সব বিভাগ</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </FilterField>
          <FilterField label="অবস্থা">
            <select name="status" defaultValue={status} className="input w-36">
              <option value="current">কর্মরত সবাই</option>
              {Object.entries(EMPLOYMENT_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              <option value="all">সব</option>
            </select>
          </FilterField>
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState message={total === 0 && !q ? "কোনো কর্মচারী নেই — \"নতুন কর্মচারী\" দিয়ে শুরু করুন" : "এই ফিল্টারে কোনো কর্মচারী নেই"} />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>আইডি</th><th>নাম</th><th>বিভাগ / পদবি</th><th>মোবাইল</th><th>যোগদান</th><th>অবস্থা</th><th className="text-right">মূল বেতন</th><th className="text-right">প্রদেয়</th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td className="font-mono text-xs">{e.code}</td>
                    <td><Link prefetch={false} href={`/payroll/employees/${e.id}`} className="font-medium hover:text-brand-700 hover:underline">{e.name}</Link></td>
                    <td className="text-sm">{[e.department?.name, e.designation].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="text-sm">{e.mobile ?? "—"}</td>
                    <td className="text-sm">{formatDate(e.joiningDate)}</td>
                    <td><Badge tone={STATUS_TONE[e.status]}>{EMPLOYMENT_STATUS_LABELS[e.status]}</Badge></td>
                    <td className="num">{formatMoney(num(e.basicSalary), cur)}</td>
                    <td className="num">{payable.get(e.id) ? <span className="text-credit">{formatMoney(payable.get(e.id)!, cur)}</span> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/payroll/employees" params={p} page={page.page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}

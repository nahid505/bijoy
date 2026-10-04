import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { formatDate, formatQty, toBnDigits, toDateInput } from "@/lib/format";
import { parsePeriod, periodKey, periodLabel } from "@/lib/payroll";
import { EmptyState, FilterBar, FilterField, PageHeader, TableWrap } from "@/components/ui";
import { requirePayroll } from "@/server/payroll-context";
import { readParams, type SearchParams } from "@/server/params";
import { saveAttendanceAction } from "@/server/actions/payroll";
import { attendanceSummaries } from "@/server/services/payroll";
import { AttendanceSheet } from "../payroll-forms";

export const metadata: Metadata = { title: "হাজিরা" };

// Shows no salary figures: users with only "payroll:attendance" may use it.
export default async function AttendancePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePayroll("payroll:attendance");
  const p = await readParams(searchParams);
  const biz = ctx.business.id;
  const summary = p.view === "summary";
  const date = p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : toDateInput();
  const day = new Date(`${date}T00:00:00.000Z`);
  const { year, month } = summary ? parsePeriod(p.period) ?? parsePeriod(date.slice(0, 7))! : { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1 };
  const departments = await prisma.department.findMany({ where: { businessId: biz }, orderBy: { name: "asc" } });
  const tab = (active: boolean) => `rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-ink-50"}`;
  const dept = p.departmentId ? `&departmentId=${p.departmentId}` : "";

  let body: React.ReactNode;
  if (!summary) {
    const employees = await prisma.employee.findMany({
      where: {
        businessId: biz,
        joiningDate: { lte: day },
        OR: [{ exitDate: null }, { exitDate: { gte: day } }],
        AND: [{ OR: [{ status: { in: ["ACTIVE", "PROBATION", "ON_LEAVE"] } }, { exitDate: { gte: day } }] }],
        ...(p.departmentId ? { departmentId: p.departmentId } : {}),
      },
      include: { department: { select: { name: true } } },
      orderBy: { code: "asc" },
    });
    const records = await prisma.attendance.findMany({ where: { businessId: biz, date: day, employeeId: { in: employees.map((e) => e.id) } } });
    const posted = await prisma.payrollRun.findFirst({ where: { businessId: biz, year, month, kind: "REGULAR", status: "POSTED" }, select: { id: true } });
    const rec = new Map(records.map((r) => [r.employeeId, r]));
    body = employees.length === 0 ? (
      <EmptyState message="এই তারিখে কোনো কর্মরত কর্মচারী নেই" />
    ) : (
      <div className="p-3">
        <AttendanceSheet
          key={`${date}-${p.departmentId ?? ""}`}
          action={saveAttendanceAction}
          date={date}
          locked={posted ? `${periodLabel(year, month)} এর বেতন চূড়ান্ত — এই মাসের হাজিরা পরিবর্তন করা যাবে না` : null}
          rows={employees.map((e) => {
            const r = rec.get(e.id);
            return { employeeId: e.id, code: e.code, name: e.name, designation: e.designation, department: e.department?.name ?? null, status: r?.status ?? "", overtimeHours: r ? num(r.overtimeHours) : 0, lateMinutes: r?.lateMinutes ?? 0, note: r?.note ?? "" };
          })}
        />
      </div>
    );
  } else {
    const s = await attendanceSummaries(biz, year, month, { departmentId: p.departmentId });
    body = s.items.length === 0 ? (
      <EmptyState message="এই মাসে কোনো কর্মরত কর্মচারী নেই" />
    ) : (
      <TableWrap>
        <table className="table">
          <thead>
            <tr><th>কর্মচারী</th><th className="text-right">কর্মদিবস</th><th className="text-right">উপস্থিত</th><th className="text-right">দেরি</th><th className="text-right">অনুপস্থিত</th><th className="text-right">ছুটি</th><th className="text-right">বিনা বেতনে</th><th className="text-right">অর্ধদিবস</th><th className="text-right">কর্তনের দিন</th><th className="text-right">ওভারটাইম (ঘণ্টা)</th></tr>
          </thead>
          <tbody>
            {s.items.map(({ employee: e, summary: a, fraction }) => (
              <tr key={e.id}>
                <td><span className="font-medium">{e.name}</span><span className="block text-xs text-slate-400">{[e.code, e.department?.name].filter(Boolean).join(" · ")}{fraction < 1 ? " · মাসের অংশ" : ""}</span></td>
                <td className="num">{formatQty(Math.round(s.workingDays * fraction * 100) / 100)}</td>
                <td className="num">{formatQty(a.present)}</td>
                <td className="num">{a.late ? toBnDigits(a.late) : "—"}</td>
                <td className="num">{a.absent ? <span className="text-credit">{toBnDigits(a.absent)}</span> : "—"}</td>
                <td className="num">{a.leave ? toBnDigits(a.leave) : "—"}</td>
                <td className="num">{a.unpaidLeave ? toBnDigits(a.unpaidLeave) : "—"}</td>
                <td className="num">{a.halfDays ? toBnDigits(a.halfDays) : "—"}</td>
                <td className="num font-semibold">{a.deductedDays ? formatQty(a.deductedDays) : "—"}</td>
                <td className="num">{a.overtimeHours ? formatQty(a.overtimeHours) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  }

  return (
    <>
      <PageHeader title="হাজিরা ও ওভারটাইম" description="শুধু ব্যতিক্রম (অনুপস্থিত, দেরি, ছুটি…) চিহ্নিত করলেই চলে — চিহ্ন না থাকা কর্মদিবস উপস্থিত ধরা হয়" crumbs={[{ label: "বেতন", href: "/payroll" }, { label: "হাজিরা" }]} />
      <nav className="mb-3 flex gap-1" aria-label="হাজিরা দেখার ধরন">
        <Link prefetch={false} href={`/payroll/attendance?date=${date}${dept}`} className={tab(!summary)}>দৈনিক হাজিরা</Link>
        <Link prefetch={false} href={`/payroll/attendance?view=summary&period=${periodKey(year, month)}${dept}`} className={tab(summary)}>মাসিক সারসংক্ষেপ</Link>
      </nav>
      <section className="panel">
        <FilterBar action="/payroll/attendance">
          {summary ? (
            <>
              <input type="hidden" name="view" value="summary" />
              <FilterField label="মাস"><input type="month" name="period" defaultValue={periodKey(year, month)} className="input w-40" /></FilterField>
            </>
          ) : (
            <FilterField label="তারিখ"><input type="date" name="date" defaultValue={date} className="input w-40" /></FilterField>
          )}
          <FilterField label="বিভাগ">
            <select name="departmentId" defaultValue={p.departmentId ?? ""} className="input w-40">
              <option value="">সব বিভাগ</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </FilterField>
        </FilterBar>
        <div className="px-4 pt-3 text-sm text-slate-600">{summary ? periodLabel(year, month) : formatDate(date)}</div>
        {body}
      </section>
    </>
  );
}

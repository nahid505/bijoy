import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AUDIT_ACTION_LABELS, dayRange, formatDateTime } from "@/lib/format";
import { Badge, EmptyState, FilterBar, FilterField, PageHeader, Pagination, TableWrap } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { pageOf, readParams, totalPages, type SearchParams } from "@/server/params";

export const metadata: Metadata = { title: "অডিট লগ" };

const ENTITY_LABELS: Record<string, string> = {
  Auth: "লগইন/লগআউট",
  Voucher: "ভাউচার",
  Account: "হিসাব",
  Customer: "কাস্টমার",
  Supplier: "সরবরাহকারী",
  Product: "পণ্য",
  category: "ক্যাটাগরি",
  brand: "ব্র্যান্ড",
  unit: "ইউনিট",
  warehouse: "গুদাম",
  Member: "ব্যবহারকারী",
  User: "ব্যবহারকারী",
  Role: "রোল",
  Business: "ব্যবসা",
  Backup: "ব্যাকআপ",
  Employee: "কর্মচারী",
  Department: "বিভাগ",
  PayComponent: "বেতনের উপাদান",
  PayrollSettings: "বেতন সেটিং",
  Attendance: "হাজিরা",
  PayrollRun: "মাসিক বেতন",
  Payslip: "পে-স্লিপ",
  SalaryPayment: "বেতন পরিশোধ",
  EmployeeAdvance: "অগ্রিম/ঋণ",
};
/** payroll audit entries carry salary figures: shown only to users who may see payroll */
const PAYROLL_ENTITIES = ["Employee", "Department", "PayComponent", "PayrollSettings", "Attendance", "PayrollRun", "Payslip", "SalaryPayment", "EmployeeAdvance"];

const ACTION_TONES: Record<string, "green" | "blue" | "red" | "amber" | "slate"> = { CREATE: "green", UPDATE: "blue", DELETE: "red", LOGIN: "slate", LOGOUT: "slate", LOGIN_FAILED: "amber" };

export default async function AuditLogsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePermission("audit:view");
  const params = await readParams(searchParams);
  const { page, skip, take } = pageOf(params);
  const range = dayRange(params.from, params.to);

  // Check if current business belongs to a group
  const group = ctx.group;

  // Check if user has central group access (isSuperAdmin, isOwner of parent, or has active groupMembership)
  const isGroupAuditor = Boolean(
    ctx.user.isSuperAdmin ||
    (group && (
      group.isParent ||
      (await prisma.groupMembership.findFirst({
        where: { userId: ctx.user.id, groupId: group.id, isActive: true },
      }))
    ))
  );

  const hasGroupView = Boolean(group && (isGroupAuditor || ctx.isOwner));
  const selectedScope = params.scope ?? "";
  
  let businessIds: string[] = [ctx.business.id];
  if (hasGroupView && group) {
    if (selectedScope === "all") {
      businessIds = group.sisterConcerns.map((b) => b.id);
    } else if (selectedScope && group.sisterConcerns.some((b) => b.id === selectedScope)) {
      businessIds = [selectedScope];
    }
  }

  const memberIds = (await prisma.membership.findMany({ where: { businessId: { in: businessIds } }, select: { userId: true } })).map((m) => m.userId);

  // Business events + login events of members.
  const where: Prisma.AuditLogWhereInput = {
    OR: [{ businessId: { in: businessIds } }, { businessId: null, entity: "Auth", userId: { in: memberIds } }],
    ...(params.entity ? { entity: params.entity } : {}),
    ...(params.action ? { action: params.action } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    ...(range.gte || range.lt ? { createdAt: range } : {}),
    ...(can(ctx, "payroll:view") ? {} : { NOT: { entity: { in: PAYROLL_ENTITIES } } }),
  };
  const [rows, total, users] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        user: { select: { name: true } },
        business: { select: { id: true, name: true, intercompanyCode: true } },
      },
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="অডিট লগ"
        description={hasGroupView ? "গ্রুপ ও প্রতিষ্ঠানের সকল পরিবর্তনের কেন্দ্রীয় অডিট রেকর্ড" : "কে, কখন, কী পরিবর্তন করেছে তার সম্পূর্ণ রেকর্ড"}
        crumbs={[{ label: "ব্যবহারকারী" }, { label: "অডিট লগ" }]}
      />
      <section className="panel">
        <FilterBar action="/audit-logs">
          {hasGroupView && group && (
            <FilterField label="প্রতিষ্ঠান (এনটিটি)">
              <select name="scope" defaultValue={selectedScope} className="input w-52">
                <option value="">বর্তমান: {ctx.business.name}</option>
                <option value="all">🌐 গ্রুপের সকল প্রতিষ্ঠান (All)</option>
                {group.sisterConcerns.map((b) => (
                  <option key={b.id} value={b.id}>
                    🏢 {b.name} {b.intercompanyCode ? `(${b.intercompanyCode})` : ""}
                  </option>
                ))}
              </select>
            </FilterField>
          )}
          <FilterField label="বিষয়">
            <select name="entity" defaultValue={params.entity ?? ""} className="input w-40">
              <option value="">সব</option>
              {Object.entries(ENTITY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </FilterField>
          <FilterField label="কাজ">
            <select name="action" defaultValue={params.action ?? ""} className="input w-36">
              <option value="">সব</option>
              {Object.entries(AUDIT_ACTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </FilterField>
          <FilterField label="ব্যবহারকারী">
            <select name="userId" defaultValue={params.userId ?? ""} className="input w-44">
              <option value="">সব</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </FilterField>
          <FilterField label="শুরু"><input type="date" name="from" defaultValue={params.from} className="input w-40" /></FilterField>
          <FilterField label="শেষ"><input type="date" name="to" defaultValue={params.to} className="input w-40" /></FilterField>
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>সময়</th>
                  {hasGroupView && <th>প্রতিষ্ঠান</th>}
                  <th>ব্যবহারকারী</th>
                  <th>কাজ</th>
                  <th>বিষয়</th>
                  <th>বিস্তারিত</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                    {hasGroupView && (
                      <td className="whitespace-nowrap">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                          {r.business?.intercompanyCode || r.business?.name || "সেন্ট্রাল"}
                        </span>
                      </td>
                    )}
                    <td>{r.user?.name ?? "—"}</td>
                    <td><Badge tone={ACTION_TONES[r.action] ?? "slate"}>{AUDIT_ACTION_LABELS[r.action] ?? r.action}</Badge></td>
                    <td>{ENTITY_LABELS[r.entity] ?? r.entity}</td>
                    <td className="max-w-md">{r.details ? <code className="block truncate text-xs text-slate-500" title={JSON.stringify(r.details)}>{JSON.stringify(r.details)}</code> : "—"}</td>
                    <td className="text-xs text-slate-400">{r.ipAddress ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Pagination basePath="/audit-logs" params={params} page={page} totalPages={totalPages(total)} total={total} />
      </section>
    </>
  );
}

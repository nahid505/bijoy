import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma, num } from "@/lib/db";
import { VOUCHER_TYPES, type VoucherTypeKey } from "@/lib/accounting";
import { formatMoney, toBnDigits, toDateInput, dayRange } from "@/lib/format";
import { round2 } from "@/lib/calc";
import { FilterField, PageHeader } from "@/components/ui";
import { can, requirePermission } from "@/server/auth";
import { getT } from "@/server/i18n";
import { readParams, type SearchParams } from "@/server/params";
import { ci } from "@/lib/dialect";
import { ApprovalQueue, type UnverifiedVoucherItem } from "./approval-queue";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("অপেক্ষমাণ লেনদেন অনুমোদন (Approval Queue)") };
}

export default async function UnverifiedVouchersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requirePermission(["view_approval_queue", "can_verify_transactions", "vouchers:verify"]);
  const t = await getT();
  const p = await readParams(searchParams);
  const cur = ctx.business.currencySymbol;

  const q = p.q?.trim();
  const typeFilter = p.type?.trim();
  const hasDateFilter = Boolean(p.from || p.to);
  const dateRange = hasDateFilter ? dayRange(p.from ?? "1970-01-01", p.to ?? toDateInput()) : undefined;

  const shouldFetchAttendance = !typeFilter || typeFilter === "ATTENDANCE";
  const shouldFetchVouchers = !typeFilter || typeFilter !== "ATTENDANCE";

  const andConditions: any[] = [
    { businessId: ctx.business.id },
    { verificationStatus: "UNVERIFIED" },
  ];

  if (typeFilter === "DEPOT_DELIVERY") {
    andConditions.push({
      OR: [
        { type: "DEPOT_DELIVERY" },
        { depotDelivery: { isNot: null } },
      ],
    });
  } else if (typeFilter && typeFilter !== "ATTENDANCE") {
    andConditions.push({ type: typeFilter as any });
  }

  if (dateRange) {
    andConditions.push({ date: dateRange });
  }

  if (q) {
    andConditions.push({
      OR: [
        { voucherNo: ci(q) },
        { reference: ci(q) },
        { narration: ci(q) },
        { partyAccount: { name: ci(q) } },
        { cashAccount: { name: ci(q) } },
        { depotDelivery: { doNumber: ci(q) } },
        { depotDelivery: { dealerAccount: { name: ci(q) } } },
        { depotDelivery: { companyAccount: { name: ci(q) } } },
      ],
    });
  }

  const where = {
    AND: andConditions,
  };

  const attAndConditions: any[] = [
    { businessId: ctx.business.id },
    { verificationStatus: "UNVERIFIED" },
  ];
  if (dateRange) {
    attAndConditions.push({ date: dateRange });
  }
  if (q) {
    attAndConditions.push({
      OR: [
        { employee: { name: ci(q) } },
        { employee: { code: ci(q) } },
        { employee: { designation: ci(q) } },
        { employee: { department: { name: ci(q) } } },
        { note: ci(q) },
      ],
    });
  }

  const [vouchersData, attendanceRows] = await Promise.all([
    shouldFetchVouchers
      ? Promise.all([
          prisma.voucher.findMany({
            where,
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: 500,
            include: {
              partyAccount: { select: { name: true } },
              cashAccount: { select: { name: true } },
              createdBy: { select: { id: true, name: true } },
              verifiedBy: { select: { id: true, name: true } },
              depotDelivery: {
                select: {
                  doNumber: true,
                  commissionTotal: true,
                  dealerAccount: { select: { name: true } },
                  companyAccount: { select: { name: true } },
                },
              },
            },
          }),
          prisma.voucher.aggregate({
            where,
            _sum: { amount: true },
            _count: true,
          }),
        ])
      : Promise.resolve([[], { _count: 0, _sum: { amount: null } } as any]),
    shouldFetchAttendance
      ? prisma.attendance.findMany({
          where: { AND: attAndConditions },
          orderBy: [{ date: "desc" }, { updatedAt: "desc" }],
          take: 500,
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                code: true,
                designation: true,
                basicSalary: true,
                department: { select: { name: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const [vouchers, sums] = vouchersData;

  const voucherItems: UnverifiedVoucherItem[] = vouchers.map((v: any) => {
    const isDepot = Boolean(v.depotDelivery || v.type === "DEPOT_DELIVERY");
    let typeLabel: string = VOUCHER_TYPES[v.type as VoucherTypeKey]?.label || v.type;
    if (isDepot) {
      typeLabel = v.type === "DEPOT_DELIVERY" ? t("ডিও ডেলিভারি চালান") : t("ডিপো ডেলিভারি চালান");
    }

    let partyName = v.partyAccount?.name ?? null;
    if (isDepot && v.depotDelivery) {
      const dealer = v.depotDelivery.dealerAccount?.name;
      const company = v.depotDelivery.companyAccount?.name || v.partyAccount?.name;
      if (dealer && company) {
        partyName = `${dealer} (${company})`;
      } else {
        partyName = dealer || company || partyName;
      }
    }

    const narration = v.narration ?? (v.depotDelivery?.doNumber ? `DO: ${v.depotDelivery.doNumber}` : null);
    const reference = v.reference ?? (v.depotDelivery?.doNumber ? `DO: ${v.depotDelivery.doNumber}` : null);
    const amt = num(v.amount) > 0 ? num(v.amount) : v.depotDelivery ? num(v.depotDelivery.commissionTotal) : 0;

    return {
      id: v.id,
      voucherNo: v.voucherNo,
      type: v.type,
      typeLabel,
      date: v.date.toISOString(),
      amount: amt,
      narration,
      reference,
      partyName,
      creatorName: v.createdBy?.name ?? null,
      cashOrBankName: v.cashAccount?.name ?? null,
    };
  });

  type AttendanceRow = (typeof attendanceRows)[number];
  const attendanceGroups = new Map<string, AttendanceRow[]>();
  for (const row of attendanceRows) {
    const dKey = row.date.toISOString().slice(0, 10);
    const existing = attendanceGroups.get(dKey);
    if (existing) {
      existing.push(row);
    } else {
      attendanceGroups.set(dKey, [row]);
    }
  }

  const attendanceItems: UnverifiedVoucherItem[] = [];
  for (const [dKey, records] of attendanceGroups.entries()) {
    const count = records.length;
    const dateFormatted = dKey.replace(/-/g, "");
    const voucherNo = `ATT-${dateFormatted}`;
    let partyName = "";
    let narration = "";

    const statusLabels: Record<string, string> = {
      PRESENT: t("উপস্থিত"),
      ABSENT: t("অনুপস্থিত"),
      LATE: t("বিলম্ব"),
      HALF_DAY: t("অর্ধদিবস"),
      LEAVE: t("ছুটি"),
      UNPAID_LEAVE: t("বিনা বেতনে ছুটি"),
      HOLIDAY: t("ছুটির দিন"),
      WEEKLY_OFF: t("সাপ্তাহিক ছুটি"),
    };

    if (count === 1) {
      const emp = records[0].employee;
      partyName = `${emp.name}${emp.designation ? ` (${emp.designation})` : emp.code ? ` (${emp.code})` : ""}`;
      const parts: string[] = [statusLabels[records[0].status] || records[0].status];
      if (num(records[0].overtimeHours) > 0) {
        parts.push(`${t("ওভারটাইম")}: ${toBnDigits(num(records[0].overtimeHours))} ${t("ঘণ্টা")}`);
      }
      if (records[0].lateMinutes > 0) {
        parts.push(`${t("বিলম্ব")}: ${toBnDigits(records[0].lateMinutes)} ${t("মি.")}`);
      }
      if (records[0].note) {
        parts.push(records[0].note);
      }
      narration = parts.join(" · ");
    } else {
      partyName = `${t("দৈনিক হাজিরা তালিকা")} (${toBnDigits(count)} ${t("জন")})`;
      const presentCount = records.filter((r) => r.status === "PRESENT").length;
      const absentCount = records.filter((r) => r.status === "ABSENT").length;
      const lateCount = records.filter((r) => r.status === "LATE").length;
      const leaveCount = records.filter((r) => r.status === "LEAVE" || r.status === "UNPAID_LEAVE").length;
      const halfCount = records.filter((r) => r.status === "HALF_DAY").length;
      const totalOvertime = records.reduce((s, r) => s + num(r.overtimeHours), 0);

      const parts: string[] = [];
      if (presentCount) parts.push(`${t("উপস্থিত")}: ${toBnDigits(presentCount)}`);
      if (absentCount) parts.push(`${t("অনুপস্থিত")}: ${toBnDigits(absentCount)}`);
      if (lateCount) parts.push(`${t("বিলম্ব")}: ${toBnDigits(lateCount)}`);
      if (halfCount) parts.push(`${t("অর্ধদিবস")}: ${toBnDigits(halfCount)}`);
      if (leaveCount) parts.push(`${t("ছুটি")}: ${toBnDigits(leaveCount)}`);
      if (totalOvertime > 0) parts.push(`${t("মোট ওভারটাইম")}: ${toBnDigits(round2(totalOvertime))} ${t("ঘণ্টা")}`);
      narration = parts.join(" · ") || t("দৈনিক হাজিরা");
    }

    attendanceItems.push({
      id: `att:${dKey}`,
      voucherNo,
      type: "ATTENDANCE",
      typeLabel: t("হাজিরা"),
      date: records[0].date.toISOString(),
      amount: 0,
      narration,
      reference: voucherNo,
      partyName,
      creatorName: t("এইচআর / স্টাফ"),
      cashOrBankName: null,
    });
  }

  const initialVouchers: UnverifiedVoucherItem[] = [
    ...voucherItems,
    ...attendanceItems,
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalCount = (sums._count ?? 0) + attendanceItems.length;
  const totalAmount = num(sums._sum.amount);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("অপেক্ষমাণ লেনদেন অনুমোদন (Approval Queue)")}
        crumbs={[{ label: t("লেনদেন"), href: "/dashboard" }, { label: t("অনুমোদন কিউ") }]}
        actions={
          <div className="flex items-center gap-2">
            <Link prefetch={false} href="/dashboard" className="btn-secondary">
              <span>← {t("ড্যাশবোর্ড")}</span>
            </Link>
          </div>
        }
      />

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="panel p-4 flex items-center gap-4 bg-gradient-to-br from-amber-50 to-orange-50/50 border-amber-200">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white shadow-xs">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <span className="text-xs font-semibold text-amber-800">{t("অপেক্ষমাণ ভাউচার সংখ্যা")}</span>
            <div className="text-2xl font-black text-slate-900 tabular-nums">
              {toBnDigits(totalCount)} <span className="text-sm font-semibold text-slate-600">{t("টি")}</span>
            </div>
          </div>
        </div>

        <div className="panel p-4 flex items-center gap-4 bg-gradient-to-br from-blue-50 to-indigo-50/50 border-blue-200">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-xs">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <div>
            <span className="text-xs font-semibold text-blue-800">{t("মোট অপেক্ষমাণ লেনদেন মূল্য")}</span>
            <div className="text-2xl font-black text-slate-900 tabular-nums">
              {formatMoney(totalAmount, cur)}
            </div>
          </div>
        </div>

        <div className="panel p-4 flex items-center gap-4 bg-gradient-to-br from-emerald-50 to-teal-50/50 border-emerald-200 sm:col-span-2 lg:col-span-1">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <span className="text-xs font-semibold text-emerald-800">{t("নিরাপত্তা ও অডিট স্তর")}</span>
            <div className="text-xs font-medium text-slate-600 mt-0.5 leading-relaxed">
              {t("শুধুমাত্র অনুমোদিত ইউজাররা লেনদেন যাচাই বা বাতিল করতে পারেন।")}
            </div>
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <section className="panel">
        <form method="get" className="no-print flex flex-wrap items-end gap-2.5 p-3.5 border-b border-rule">
          <FilterField label={t("শুরু")}>
            <input type="date" name="from" defaultValue={p.from ?? ""} className="input w-36" />
          </FilterField>
          <FilterField label={t("শেষ")}>
            <input type="date" name="to" defaultValue={p.to ?? ""} className="input w-36" />
          </FilterField>
          <FilterField label={t("লেনদেনের ধরন")}>
            <select name="type" defaultValue={typeFilter ?? ""} className="input w-48">
              <option value="">{t("সকল ধরন")}</option>
              <option value="ATTENDANCE">{t("হাজিরা")}</option>
              <option value="SALES">{t("বিক্রয়")}</option>
              <option value="PURCHASE">{t("ক্রয়")}</option>
              <option value="RECEIPT">{t("রিসিপ্ট")}</option>
              <option value="PAYMENT">{t("পেমেন্ট")}</option>
              <option value="JOURNAL">{t("জার্নাল")}</option>
              <option value="DEPOT_DELIVERY">{t("ডিপো ডেলিভারি চালান")}</option>
              <option value="PRODUCTION">{t("উৎপাদন")}</option>
              <option value="SALES_RETURN">{t("বিক্রয় ফেরত")}</option>
              <option value="PURCHASE_RETURN">{t("ক্রয় ফেরত")}</option>
              <option value="STOCK_JOURNAL">{t("স্টক জার্নাল")}</option>
            </select>
          </FilterField>
          <FilterField label={t("খুঁজুন")}>
            <input
              name="q"
              defaultValue={q}
              placeholder={t("নম্বর, পার্টি, বিবরণ…")}
              className="input w-52"
            />
          </FilterField>
          <button type="submit" className="btn-secondary">
            {t("ফিল্টার")}
          </button>
          <Link prefetch={false} href="/audit/unverified" className="btn-ghost">
            {t("রিসেট")}
          </Link>
        </form>

        {/* ── Queue Table / Cards Component ── */}
        <div className="p-3.5">
          <ApprovalQueue
            initialVouchers={initialVouchers}
            currency={cur}
            currentUserName={ctx.user.name}
            canVerify={can(ctx, ["can_verify_transactions", "vouchers:verify"])}
            canReject={can(ctx, ["can_reject_transactions", "vouchers:verify"])}
          />
        </div>
      </section>
    </div>
  );
}

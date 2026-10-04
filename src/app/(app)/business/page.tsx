import { normalizeThresholds } from "@/lib/expiry";
import type { Metadata } from "next";
import { prisma, num } from "@/lib/db";
import { toDateInput } from "@/lib/format";
import { NewBusinessForm } from "@/components/new-business-form";
import { Badge, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { BusinessForm } from "./business-form";

export const metadata: Metadata = { title: "ব্যবসা সেটিং" };

export default async function BusinessPage() {
  const ctx = await requirePermission("business:manage");
  const b = await prisma.business.findUniqueOrThrow({ where: { id: ctx.business.id } });
  return (
    <>
      <PageHeader title="ব্যবসা সেটিং" description="প্রোফাইল, BIN/TIN, অর্থবছর, মুদ্রা ও ইনভয়েস সেটিং" />
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="panel p-5 xl:col-span-2">
          <BusinessForm
            d={{
              name: b.name, logo: b.logo, address: b.address, mobile: b.mobile, email: b.email, binNumber: b.binNumber, tinNumber: b.tinNumber,
              tradeLicense: b.tradeLicense, currency: b.currency, currencySymbol: b.currencySymbol, fiscalYearStartMonth: b.fiscalYearStartMonth,
              booksStartDate: toDateInput(b.booksStartDate), invoicePrefix: b.invoicePrefix, defaultVatPercent: num(b.defaultVatPercent),
              invoiceFooter: b.invoiceFooter, invoiceTerms: b.invoiceTerms, lockDate: b.lockDate ? toDateInput(b.lockDate) : "",
              expiryWarningDays: normalizeThresholds(b.expiryWarningDays), allowExpiredSale: b.allowExpiredSale,
            }}
          />
        </section>
        <div className="space-y-4">
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">আমার ব্যবসাসমূহ</h2></div>
            <ul className="divide-y divide-rule text-sm">
              {ctx.businesses.map((x) => (
                <li key={x.id} className="flex items-center justify-between px-4 py-2.5">
                  <span>{x.name}</span>
                  {x.id === ctx.business.id ? <Badge tone="green">বর্তমান</Badge> : <span className="text-xs text-slate-500">{x.roleName}</span>}
                </li>
              ))}
            </ul>
            <p className="border-t border-rule px-4 py-2 text-xs text-slate-500">উপরের বার থেকে ব্যবসা পরিবর্তন করুন। প্রতিটি ব্যবসার তথ্য সম্পূর্ণ আলাদা থাকে।</p>
          </section>
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title">নতুন ব্যবসা খুলুন</h2></div>
            <div className="p-4"><NewBusinessForm /></div>
          </section>
        </div>
      </div>
    </>
  );
}

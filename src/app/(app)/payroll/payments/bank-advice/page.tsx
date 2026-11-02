import type { Metadata } from "next";
import Link from "next/link";
import { formatDate, formatMoney, toBnDigits, toDateInput } from "@/lib/format";
import { round2 } from "@/lib/calc";
import { AmountInWords } from "@/components/amount-words";
import { PrintButton } from "@/components/forms";
import { requirePayroll } from "@/server/payroll-context";
import { readParams, type SearchParams } from "@/server/params";
import { getBankSalaryAdviceData } from "@/server/payroll-bank-advice";

export const metadata: Metadata = { title: "ব্যাংক স্যালারি অ্যাডভাইস লেটার" };

const th = "border border-ink-800 bg-ink-50 px-2 py-1.5 text-xs font-semibold print:bg-slate-100 print:text-[10px]";
const td = "border border-ink-800 px-2 py-1.5 text-xs print:text-[10px]";
const numCell = `${td} text-right tabular-nums whitespace-nowrap`;

export default async function BankSalaryAdvicePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requirePayroll("payroll:view");
  const p = await readParams(searchParams);
  const now = new Date();
  const year = Number(p.year) || now.getFullYear();
  const month = Number(p.month) || now.getMonth() + 1;
  const bankAccountId = (p.accountId as string) || undefined;
  const refNo = (p.ref as string) || `BL/SAL/${year}/${String(month).padStart(2, "0")}`;
  const requestedTemplate = (p.template as string) || "";

  const data = await getBankSalaryAdviceData(ctx.business.id, {
    year,
    month,
    bankAccountId,
  });

  const payingBankName = data.payingBank?.bankName || data.payingBank?.name || "";
  const isDbblBank =
    payingBankName.toLowerCase().includes("dutch") ||
    payingBankName.toLowerCase().includes("dbbl") ||
    payingBankName.includes("ডাচ-বাংলা");

  const isDbbl = requestedTemplate === "dbbl" || (requestedTemplate !== "standard" && isDbblBank);

  const cur = data.business.currencySymbol;
  const todayStr = (p.date as string) || toDateInput();
  const exportBase = `/api/payroll/bank-advice?year=${year}&month=${month}${bankAccountId ? `&accountId=${bankAccountId}` : ""}`;
  const toggleUrl = `/payroll/payments/bank-advice?year=${year}&month=${month}${bankAccountId ? `&accountId=${bankAccountId}` : ""}&ref=${encodeURIComponent(refNo)}&date=${todayStr}&template=${isDbbl ? "standard" : "dbbl"}`;

  const dbblCount = data.items.filter((i) => i.transferType === "DBBL").length;
  const dbblAmount = round2(data.items.filter((i) => i.transferType === "DBBL").reduce((s, i) => s + i.netAmount, 0));
  const rocketCount = data.items.filter((i) => i.transferType === "ROCKET").length;
  const rocketAmount = round2(data.items.filter((i) => i.transferType === "ROCKET").reduce((s, i) => s + i.netAmount, 0));
  const beftnCount = data.items.filter((i) => i.transferType === "BEFTN").length;
  const beftnAmount = round2(data.items.filter((i) => i.transferType === "BEFTN").reduce((s, i) => s + i.netAmount, 0));

  return (
    <>
      {/* Top action bar: hidden when printed */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link prefetch={false} href="/payroll/payments" className="btn-secondary">
            ← বেতন পরিশোধ
          </Link>
          <span className="text-sm text-slate-500 font-medium">
            {data.periodLabelBn} ({data.periodLabelEn})
          </span>
          {isDbbl ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
              🏦 DBBL ও রকেট ফরম্যাট
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
              🏛️ সাধারণ ব্যাংক (BEFTN)
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            prefetch={false}
            href={toggleUrl}
            className={`btn-secondary text-xs inline-flex items-center gap-1 ${
              isDbbl ? "text-slate-700" : "text-emerald-800 border-emerald-300 bg-emerald-50 hover:bg-emerald-100"
            }`}
          >
            {isDbbl ? "🔄 সাধারণ ব্যাংক ফরম্যাট দেখুন" : "🏦 DBBL ও রকেট ফরম্যাট দেখুন"}
          </Link>
          <PrintButton label="🖨️ প্রিন্ট / PDF" />
          <a
            href={`${exportBase}&template=dbbl&format=xlsx`}
            className="btn-secondary inline-flex items-center gap-1.5 text-emerald-900 bg-emerald-50/80 hover:bg-emerald-100 font-medium"
            download
            title="৭ কলাম বিশিষ্ট ডিবিবিএল বাল্ক আপলোড এক্সেল ফাইল"
          >
            📊 DBBL Excel (.xlsx)
          </a>
          <a
            href={`${exportBase}&template=dbbl&format=csv`}
            className="btn-secondary inline-flex items-center gap-1.5 text-purple-900 bg-purple-50/80 hover:bg-purple-100 font-medium"
            download
            title="ডিবিবিএল ও রকেট বাল্ক সিএসভি ফাইল"
          >
            ⚡ DBBL CSV
          </a>
          <a
            href={`${exportBase}&format=xlsx`}
            className="btn-ghost inline-flex items-center gap-1 text-xs text-slate-600 hover:text-ink-900"
            download
          >
            সাধারণ Excel
          </a>
        </div>
      </div>

      {/* Printable Bank Salary Advice Letter */}
      <article className="panel print-area mx-auto max-w-[210mm] bg-white p-6 sm:p-10 text-ink-900 print:border-none print:p-0 print:shadow-none">
        {/* Company Letterhead */}
        <header className="border-b-2 border-ink-800 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {data.business.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.business.logo} alt="" className="h-14 w-14 object-contain" />
              )}
              <div>
                <h1 className="text-xl font-bold tracking-tight text-ink-900">{data.business.name}</h1>
                {data.business.address && (
                  <p className="whitespace-pre-line text-xs text-slate-600">{data.business.address}</p>
                )}
                <p className="text-xs text-slate-600">
                  {[data.business.mobile, data.business.email].filter(Boolean).join(" · ")}
                </p>
                {data.business.tinNumber && (
                  <p className="text-xs text-slate-600">TIN: {data.business.tinNumber}</p>
                )}
              </div>
            </div>
            <div className="text-right text-xs">
              <p className="font-semibold text-slate-700">স্মারক নং: <span className="font-mono">{refNo}</span></p>
              <p className="text-slate-700">তারিখ: <b>{formatDate(todayStr)}</b></p>
            </div>
          </div>
        </header>

        {/* Addressee & Salutation */}
        <section className="mt-6 space-y-1 text-sm leading-relaxed">
          <p>বরাবর,</p>
          <p className="font-semibold">শাখা ব্যবস্থাপক,</p>
          {isDbbl ? (
            <>
              <p className="font-bold text-ink-900">ডাচ-বাংলা ব্যাংক পিএলসি</p>
              <p className="text-slate-600">
                {data.payingBank?.name?.includes("শাখা")
                  ? data.payingBank.name
                  : `${data.payingBank?.bankName || data.payingBank?.name || "প্রধান"} শাখা`}
              </p>

              <p className="pt-4 font-bold text-base text-ink-900 underline underline-offset-4">
                বিষয়: {data.periodLabelBn} মাসের বেতন ডাচ-বাংলা ব্যাংক হিসাব ও রকেট (Rocket) ওয়ালেটে প্রদান প্রসঙ্গে।
              </p>

              <p className="pt-2">জনাব,</p>
              <p className="text-justify indent-6 leading-relaxed">
                বিনীত নিবেদন এই যে, আমাদের প্রতিষ্ঠানের <b>{data.periodLabelBn}</b> মাসের মোট{" "}
                <b>{toBnDigits(data.totalEmployees)}</b> জন কর্মকর্তা ও কর্মচারীর বেতন বাবদ সর্বমোট{" "}
                <b>{formatMoney(data.totalNetAmount, cur)}</b> (কথায়:{" "}
                <b><AmountInWords amount={data.totalNetAmount} /></b>) টাকা আমাদের প্রতিষ্ঠান চলতি হিসাব নং{" "}
                <b className="font-mono">{data.payingBank?.accountNumber || data.payingBank?.name || "—"}</b> হতে ডেবিট করে নিচে
                বর্ণিত কর্মকর্তা ও কর্মচারীদের স্ব-স্ব ডাচ-বাংলা ব্যাংক হিসাব, রকেট (Rocket) মোবাইল ওয়ালেট এবং অন্যান্য ব্যাংকে (BEFTN) ক্রেডিট / স্থানান্তর করার জন্য বিশেষভাবে অনুরোধ জানাচ্ছি।
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-ink-900">
                {data.payingBank?.bankName || data.payingBank?.name || "সংশ্লিষ্ট ব্যাংক"}
              </p>
              <p className="text-slate-600">
                {data.payingBank?.name?.includes("শাখা") ? data.payingBank.name : "প্রধান শাখা / সংশ্লিষ্ট শাখা"}
              </p>

              <p className="pt-4 font-bold text-base text-ink-900 underline underline-offset-4">
                বিষয়: {data.periodLabelBn} মাসের কর্মকর্তা ও কর্মচারীদের বেতন প্রদান প্রসঙ্গে।
              </p>

              <p className="pt-2">জনাব,</p>
              <p className="text-justify indent-6 leading-relaxed">
                বিনীত নিবেদন এই যে, আমাদের প্রতিষ্ঠানের <b>{data.periodLabelBn}</b> মাসের মোট{" "}
                <b>{toBnDigits(data.totalEmployees)}</b> জন কর্মকর্তা ও কর্মচারীর বেতন বাবদ সর্বমোট{" "}
                <b>{formatMoney(data.totalNetAmount, cur)}</b> (কথায়:{" "}
                <b><AmountInWords amount={data.totalNetAmount} /></b>) টাকা আমাদের প্রতিষ্ঠান হিসাব নং{" "}
                <b>{data.payingBank?.accountNumber || data.payingBank?.name || "—"}</b> হতে ডেবিট করে নিচে
                বর্ণিত কর্মকর্তা ও কর্মচারীদের স্ব-স্ব ব্যাংক হিসাবে ক্রেডিট / স্থানান্তর (BEFTN / EFT) করার জন্য বিশেষভাবে অনুরোধ জানাচ্ছি।
              </p>
            </>
          )}
        </section>

        {/* Summary Info Cards */}
        <section className="my-4 rounded-lg border border-rule bg-ink-50 p-3 text-xs print:bg-slate-50 print:py-2 space-y-2.5">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <span className="text-slate-500 block">মোট কর্মকর্তা ও কর্মচারী:</span>
              <b className="text-sm text-ink-900">{toBnDigits(data.totalEmployees)} জন</b>
            </div>
            <div>
              <span className="text-slate-500 block">সর্বমোট ডেবিট টাকা:</span>
              <b className="text-sm text-ink-900 tabular-nums">{formatMoney(data.totalNetAmount, cur)}</b>
            </div>
            <div>
              <span className="text-slate-500 block">{isDbbl ? "ডিবিবিএল চলতি হিসাব নং:" : "ডেবিট হিসাব নং:"}</span>
              <b className="text-sm font-mono text-ink-900">
                {data.payingBank?.accountNumber || data.payingBank?.name || "—"}
              </b>
            </div>
          </div>

          {/* Breakdown for DBBL & Rocket advice */}
          {isDbbl && (
            <div className="pt-2 border-t border-rule/60 flex flex-wrap items-center gap-3 text-[11px] text-slate-700">
              <span className="font-semibold text-slate-900">ডিসবার্সমেন্ট বিভাজন:</span>
              <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 border border-emerald-200 text-emerald-900">
                🏦 DBBL অ্যাকাউন্ট: <b>{toBnDigits(dbblCount)} জন</b> ({formatMoney(dbblAmount, cur)})
              </span>
              <span className="inline-flex items-center gap-1 rounded bg-purple-50 px-2 py-0.5 border border-purple-200 text-purple-900">
                📱 রকেট ওয়ালেট: <b>{toBnDigits(rocketCount)} জন</b> ({formatMoney(rocketAmount, cur)})
              </span>
              {beftnCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 border border-blue-200 text-blue-900">
                  🏛️ অন্যান্য ব্যাংক (BEFTN): <b>{toBnDigits(beftnCount)} জন</b> ({formatMoney(beftnAmount, cur)})
                </span>
              )}
            </div>
          )}
        </section>

        {/* Beneficiary Employees Schedule Table */}
        <section className="mt-4">
          <h3 className="mb-2 text-xs font-bold text-slate-700">
            {isDbbl
              ? "কর্মকর্তা ও কর্মচারীদের ডিবিবিএল, রকেট ও ব্যাংক হিসাব বিবরণী:"
              : "কর্মকর্তা ও কর্মচারীদের ব্যাংক হিসাব বিবরণী:"}
          </h3>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full border-collapse border border-ink-800 text-xs print:text-[10px]">
              <thead>
                <tr>
                  <th scope="col" className={`${th} w-10 text-center`}>ক্রমিক</th>
                  <th scope="col" className={`${th} text-left`}>কর্মচারীর নাম</th>
                  <th scope="col" className={`${th} text-left`}>আইডি ও পদবি</th>
                  {isDbbl && <th scope="col" className={`${th} text-center`}>টাইপ</th>}
                  <th scope="col" className={`${th} text-left font-mono`}>{isDbbl ? "হিসাব / রকেট নং" : "হিসাব নম্বর"}</th>
                  <th scope="col" className={`${th} text-left`}>ব্যাংক ও শাখা</th>
                  <th scope="col" className={`${th} text-center`}>রাউটিং নম্বর</th>
                  <th scope="col" className={`${th} text-right`}>নিট বেতন</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={isDbbl ? 8 : 7} className="border border-ink-800 py-6 text-center text-slate-500">
                      এই মাসের জন্য কোনো অনুমোদিত পে-স্লিপ পাওয়া যায়নি
                    </td>
                  </tr>
                ) : (
                  data.items.map((i) => (
                    <tr key={i.employeeId} className="align-top">
                      <td className={`${td} text-center tabular-nums`}>{toBnDigits(i.slNo)}</td>
                      <td className={td}>
                        <span className="font-semibold block">{i.beneficiaryName}</span>
                        {i.beneficiaryName !== i.employeeName && (
                          <span className="text-[10px] text-slate-500 block">{i.employeeName}</span>
                        )}
                      </td>
                      <td className={td}>
                        <span className="font-mono text-[11px] block">{i.employeeCode}</span>
                        <span className="text-slate-500 text-[10px] block">{i.designation}</span>
                      </td>
                      {isDbbl && (
                        <td className={`${td} text-center whitespace-nowrap`}>
                          {i.transferType === "DBBL" ? (
                            <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              DBBL
                            </span>
                          ) : i.transferType === "ROCKET" ? (
                            <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-800">
                              রকেট
                            </span>
                          ) : (
                            <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800">
                              BEFTN
                            </span>
                          )}
                        </td>
                      )}
                      <td className={`${td} font-mono font-medium text-slate-900`}>{i.accountNumber}</td>
                      <td className={td}>
                        <span className="block">{i.bankName}</span>
                        {i.branchName && i.branchName !== "—" && (
                          <span className="text-[10px] text-slate-500 block">{i.branchName}</span>
                        )}
                      </td>
                      <td className={`${td} text-center font-mono`}>
                        {isDbbl && (i.transferType === "DBBL" || i.transferType === "ROCKET")
                          ? (i.routingNumber && i.routingNumber.startsWith("090") ? i.routingNumber : "090260000")
                          : i.routingNumber}
                      </td>
                      <td className={numCell}><b>{formatMoney(i.netAmount, cur)}</b></td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-ink-50 print:bg-slate-100">
                  <td colSpan={isDbbl ? 7 : 6} className={`${td} text-right`}>
                    সর্বমোট ({toBnDigits(data.totalEmployees)} জন)
                  </td>
                  <td className={numCell}>
                    <span className="underline decoration-double underline-offset-2">
                      {formatMoney(data.totalNetAmount, cur)}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* Closing & Signatures */}
        <section className="mt-12 print:mt-10 print:break-inside-avoid">
          <div className="flex justify-between items-end text-xs">
            <div>
              <p>ধন্যবাদান্তে,</p>
              <p className="font-semibold mt-1">আপনার বিশ্বস্ত,</p>
              <p className="mt-8 font-bold text-ink-900">{data.business.name}-এর পক্ষে</p>
            </div>
            <div className="text-center">
              <div className="w-56 border-t-2 border-ink-800 pt-1.5 font-bold">
                স্বত্বাধিকারী / ব্যবস্থাপনা পরিচালক
              </div>
              <p className="text-slate-500 text-[10px]">(অনুমোদিত স্বাক্ষর ও সিল)</p>
            </div>
          </div>
        </section>
      </article>
    </>
  );
}

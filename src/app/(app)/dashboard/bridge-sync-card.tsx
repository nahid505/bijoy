import Link from "next/link";
import { formatDateTime, formatNumber } from "@/lib/format";
import { ActionButton } from "@/components/forms";
import { postToMainAccountAction, rejectBridgeSyncAction } from "@/server/actions/custom-milling";

interface PendingBatch {
  id: string;
  batchNo: string;
  date: Date;
  paddyType: string;
  standardBags75Kg: number;
  totalBillAmount: number;
  party: {
    name: string;
  };
}

interface PendingExpense {
  id: string;
  date: Date;
  category: string;
  description: string;
  amount: number;
}

const CATEGORY_NAMES: Record<string, string> = {
  MILL_RENT: "মিলের ভাড়া (Rent)",
  ELECTRICITY_FUEL: "বিদ্যুৎ ও জ্বালানি / ডিজেল",
  LABOUR: "শ্রমিক মজুরি (Labour)",
  PARTS_MAINTENANCE: "যন্ত্রাংশ ও মেরামত",
  OTHER: "অন্যান্য মিল খরচ",
};

export function RiceMillBridgeCard({
  pendingBatches = [],
  pendingExpenses = [],
}: {
  pendingBatches?: PendingBatch[];
  pendingExpenses?: PendingExpense[];
}) {
  const batches = pendingBatches ?? [];
  const expenses = pendingExpenses ?? [];
  const totalBatchAmount = batches.reduce((sum, b) => sum + (b.totalBillAmount || 0), 0);
  const totalExpenseAmount = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalPendingItems = batches.length + expenses.length;

  return (
    <section className="mb-6 rounded-2xl border-2 border-amber-300 bg-linear-to-br from-amber-50/90 via-white to-amber-50/50 p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-amber-200/80 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white text-lg shadow-xs">
            🌉
          </span>
          <div>
            <h3 className="text-base font-bold text-amber-950 flex items-center gap-2">
              <span>রাইস মিল ৬০% জেভি ব্রিজ সিঙ্ক (Rice Mill JV Bridge)</span>
              {totalPendingItems > 0 && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-black text-white animate-pulse">
                  {totalPendingItems} টি অপেক্ষমাণ
                </span>
              )}
            </h3>
            <p className="text-xs text-amber-900/80">
              মালিকের নিজস্ব ব্যবসার ধান মাড়াই বিল এবং পার্টনার ১ (নাহিদ হাসান)-এর পকেট খরচের হিসাব
            </p>
          </div>
        </div>

        <Link
          href="/custom-milling"
          prefetch={false}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-900 shadow-2xs hover:bg-amber-100 transition"
        >
          <span>🌾 রাইস মিল ৬০:৪০ জেভি ড্যাশবোর্ড</span>
          <span>→</span>
        </Link>
      </div>

      {/* Summary Counters */}
      <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-200/80 bg-white/90 p-3 shadow-2xs">
          <p className="text-[11px] font-semibold text-amber-900">মালিকের নিজস্ব ধান মাড়াই বিল (পেন্ডিং)</p>
          <p className="text-lg font-black text-amber-950">
            ৳ {formatNumber(totalBatchAmount)}{" "}
            <span className="text-xs font-semibold text-slate-500">({batches.length} টি ব্যাচ)</span>
          </p>
        </div>

        <div className="rounded-xl border border-amber-200/80 bg-white/90 p-3 shadow-2xs">
          <p className="text-[11px] font-semibold text-amber-900">পার্টনার ১ (নাহিদ হাসান) পকেট খরচ (পেন্ডিং)</p>
          <p className="text-lg font-black text-amber-950">
            ৳ {formatNumber(totalExpenseAmount)}{" "}
            <span className="text-xs font-semibold text-slate-500">({expenses.length} টি খরচ)</span>
          </p>
        </div>
      </div>

      {totalPendingItems === 0 ? (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-center text-xs text-emerald-800 font-semibold">
          ✅ মূল ব্যবসায় অন্তর্ভুক্তির জন্য কোনো পেন্ডিং মিল বিল বা খরচ নেই। সবকিছু সমন্বিত রয়েছে।
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Batches List */}
          {batches.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-amber-950 mb-2 flex items-center gap-1.5">
                <span>🌾</span>
                <span>নিজস্ব ধান মাড়াই বিল ({batches.length})</span>
              </h4>

              <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white">
                <table className="table w-full text-xs">
                  <thead className="bg-amber-100/60 text-amber-950">
                    <tr>
                      <th>তারিখ ও ব্যাচ</th>
                      <th>ধানের জাত</th>
                      <th className="num">৭৫ কেজি বস্তা</th>
                      <th className="num">মোট বিল</th>
                      <th className="text-right">মূল হিসাবে পোস্টিং একশন</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id} className="hover:bg-amber-50/40">
                        <td className="whitespace-nowrap font-mono font-bold text-slate-800">
                          {b.batchNo}
                          <span className="block text-[10px] text-slate-400 font-normal">
                            {formatDateTime(b.date)}
                          </span>
                        </td>
                        <td className="font-semibold text-slate-700">{b.paddyType}</td>
                        <td className="num font-bold text-slate-900">{b.standardBags75Kg}</td>
                        <td className="num font-black text-brand-700">৳ {formatNumber(b.totalBillAmount)}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <ActionButton
                              action={postToMainAccountAction.bind(null, "BATCH", b.id)}
                              label="✓ মূল হিসাবে এন্ট্রি দিন"
                              confirmText={`ব্যাচ #${b.batchNo} এর বিল (৳${formatNumber(b.totalBillAmount)}) মূল ব্যবসায় অন্তর্ভুক্ত করতে চান?`}
                              className="btn-primary btn-sm text-xs font-semibold py-1 px-2.5"
                            />
                            <ActionButton
                              action={rejectBridgeSyncAction.bind(null, "BATCH", b.id)}
                              label="✕ বাতিল"
                              confirmText="আপনি কি এই ব্রিজ সিঙ্ক আইটেমটি বাতিল করতে চান?"
                              className="btn-danger btn-sm text-xs font-semibold py-1 px-2"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Expenses List */}
          {expenses.length > 0 && (
            <div>
              <h4 className="text-xs font-bold text-amber-950 mb-2 flex items-center gap-1.5">
                <span>💸</span>
                <span>নাহিদ হাসানের পকেট থেকে পরিশোধিত মিল খরচ ({expenses.length})</span>
              </h4>

              <div className="overflow-x-auto rounded-xl border border-amber-200 bg-white">
                <table className="table w-full text-xs">
                  <thead className="bg-amber-100/60 text-amber-950">
                    <tr>
                      <th>তারিখ</th>
                      <th>খাত</th>
                      <th>বিবরণ</th>
                      <th className="num">টাকা</th>
                      <th className="text-right">মূল হিসাবে পোস্টিং একশন</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((e) => (
                      <tr key={e.id} className="hover:bg-amber-50/40">
                        <td className="whitespace-nowrap text-slate-600">{formatDateTime(e.date)}</td>
                        <td className="font-semibold text-slate-700">
                          {CATEGORY_NAMES[e.category] || e.category}
                        </td>
                        <td className="text-slate-800">{e.description}</td>
                        <td className="num font-black text-red-700">৳ {formatNumber(e.amount)}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <ActionButton
                              action={postToMainAccountAction.bind(null, "EXPENSE", e.id)}
                              label="✓ মূল হিসাবে এন্ট্রি দিন"
                              confirmText={`খরচ '${e.description}' (৳${formatNumber(e.amount)}) মূল ব্যবসায় অন্তর্ভুক্ত করতে চান?`}
                              className="btn-primary btn-sm text-xs font-semibold py-1 px-2.5"
                            />
                            <ActionButton
                              action={rejectBridgeSyncAction.bind(null, "EXPENSE", e.id)}
                              label="✕ বাতিল"
                              confirmText="আপনি কি এই খরচ সিঙ্ক আইটেমটি বাতিল করতে চান?"
                              className="btn-danger btn-sm text-xs font-semibold py-1 px-2"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatMoney, formatDate, toBnDigits } from "@/lib/format";
import { payDriverFareAction, saveCompanyVehicleAction, deleteCompanyVehicleAction } from "@/server/actions/logistics";
import type { CompanyVehicle, DriverTrip } from "@prisma/client";

function ClientStatCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "green" | "red" | "amber" | "blue";
}) {
  const tones = {
    slate: "text-ink-900",
    green: "text-brand-700",
    red: "text-credit",
    amber: "text-amber-700",
    blue: "text-debit",
  };
  return (
    <div className="panel px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${tones[tone]}`}>{value}</p>
    </div>
  );
}

export interface DriverClientProps {
  summary: {
    totalTrips: number;
    totalEarned: number;
    totalPaid: number;
    due: number;
  };
  trips: (Omit<DriverTrip, "totalQuantity" | "tripFare" | "paidAmount"> & {
    totalQuantity: number | null;
    tripFare: number;
    paidAmount: number;
    voucher: {
      id: string;
      voucherNo: string;
      type: string;
      partyAccount: { name: string } | null;
    } | null;
    vehicle: { id: string; vehicleNo: string } | null;
  })[];
  uniqueDrivers: { driverName: string; driverMobile: string | null }[];
  companyVehicles: CompanyVehicle[];
  paymentAccounts: { id: string; name: string; group: string; balance?: number }[];
  selectedDriver: string;
  currency: string;
  page: number;
  totalPages: number;
}

export function DriverClient({
  summary,
  trips,
  uniqueDrivers,
  companyVehicles,
  paymentAccounts,
  selectedDriver,
  currency,
  page,
  totalPages,
}: DriverClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Payment modal state
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payDriverName, setPayDriverName] = useState(selectedDriver || "");
  const [payDriverMobile, setPayDriverMobile] = useState("");
  const [payAmount, setPayAmount] = useState(summary.due > 0 ? String(summary.due) : "");
  const [payCashAccountId, setPayCashAccountId] = useState(paymentAccounts[0]?.id || "");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payReference, setPayReference] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payError, setPayError] = useState("");

  // Vehicle modal state
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [editVehicleId, setEditVehicleId] = useState<string | null>(null);
  const [vehicleNo, setVehicleNo] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vDriverName, setVDriverName] = useState("");
  const [vDriverMobile, setVDriverMobile] = useState("");
  const [vehicleError, setVehicleError] = useState("");

  const handleDriverFilter = (driver: string) => {
    startTransition(() => {
      const sp = new URLSearchParams(window.location.search);
      if (driver) {
        sp.set("driver", driver);
      } else {
        sp.delete("driver");
      }
      sp.set("page", "1");
      router.push(`/logistics/drivers?${sp.toString()}`);
    });
  };

  const openPaymentModal = (driver?: string) => {
    const d = driver || selectedDriver || "";
    setPayDriverName(d);
    const matched = uniqueDrivers.find((x) => x.driverName === d);
    setPayDriverMobile(matched?.driverMobile || "");
    setPayAmount(summary.due > 0 ? String(summary.due) : "");
    setPayError("");
    setPayModalOpen(true);
  };

  const handlePaySubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPayError("");
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      const res = await payDriverFareAction(null, fd);
      if (!res?.ok) {
        setPayError(res?.message || "ত্রুটি ঘটেছে");
      } else {
        setPayModalOpen(false);
        router.refresh();
      }
    });
  };

  const openVehicleModal = (veh?: CompanyVehicle) => {
    if (veh) {
      setEditVehicleId(veh.id);
      setVehicleNo(veh.vehicleNo);
      setVehicleModel(veh.model || "");
      setVDriverName(veh.driverName || "");
      setVDriverMobile(veh.driverMobile || "");
    } else {
      setEditVehicleId(null);
      setVehicleNo("");
      setVehicleModel("");
      setVDriverName("");
      setVDriverMobile("");
    }
    setVehicleError("");
    setVehicleModalOpen(true);
  };

  const handleVehicleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setVehicleError("");
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      const res = await saveCompanyVehicleAction(editVehicleId, null, fd);
      if (!res?.ok) {
        setVehicleError(res?.message || "ত্রুটি ঘটেছে");
      } else {
        setVehicleModalOpen(false);
        router.refresh();
      }
    });
  };

  const handleDeleteVehicle = async (id: string) => {
    if (!confirm("আপনি কি নিশ্চিত এই গাড়িটি মুছে ফেলতে চান?")) return;
    startTransition(async () => {
      await deleteCompanyVehicleAction(id);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {/* Top Controls: Driver Filter & Action Buttons */}
      <div className="panel p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-slate-700" htmlFor="filter-driver">
            ড্রাইভার ফিল্টার:
          </label>
          <select
            id="filter-driver"
            className="input w-auto min-w-[200px] text-sm"
            value={selectedDriver}
            onChange={(e) => handleDriverFilter(e.target.value)}
          >
            <option value="">— সকল ড্রাইভার —</option>
            {uniqueDrivers.map((d) => (
              <option key={d.driverName} value={d.driverName}>
                {d.driverName} {d.driverMobile ? `(${d.driverMobile})` : ""}
              </option>
            ))}
          </select>
          {selectedDriver && (
            <button
              type="button"
              className="btn-ghost btn-sm text-xs text-slate-500"
              onClick={() => handleDriverFilter("")}
            >
              রিসেট
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary text-xs flex items-center gap-1.5"
            onClick={() => openVehicleModal()}
          >
            <span>🚗</span>
            <span>কোম্পানির গাড়ি যোগ / তালিকা ({toBnDigits(companyVehicles.length)})</span>
          </button>
          <button
            type="button"
            className="btn-primary text-xs flex items-center gap-1.5"
            onClick={() => openPaymentModal()}
          >
            <span>৳</span>
            <span>ভাড়া পরিশোধ করুন (Pay Driver)</span>
          </button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ClientStatCard
          label="মোট ট্রিপ সংখ্যা"
          value={`${toBnDigits(summary.totalTrips)} টি`}
          tone="blue"
        />
        <ClientStatCard
          label="মোট অর্জিত ভাড়া"
          value={formatMoney(summary.totalEarned, currency)}
          tone="slate"
        />
        <ClientStatCard
          label="পরিশোধিত ভাড়া"
          value={formatMoney(summary.totalPaid, currency)}
          tone="green"
        />
        <ClientStatCard
          label="বর্তমান বকেয়া ভাড়া"
          value={formatMoney(summary.due, currency)}
          tone={summary.due > 0 ? "amber" : undefined}
        />
      </div>

      {/* Trips History Table */}
      <section className="panel overflow-hidden border border-slate-200">
        <div className="panel-head border-b border-slate-200 bg-slate-50/70 px-4 py-3 flex justify-between items-center">
          <h2 className="panel-title flex items-center gap-2">
            <span>ট্রিপ হিস্ট্রি ও ভাড়া লেজার</span>
            <span className="inline-flex items-center rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-bold text-brand-800">
              {toBnDigits(trips.length)} টি প্রদর্শিত
            </span>
          </h2>
        </div>

        {trips.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">
            কোনো ড্রাইভার ট্রিপের তথ্য পাওয়া যায়নি
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>তারিখ</th>
                  <th>ভাউচার নং ও পার্টি</th>
                  <th>গাড়ির নম্বর</th>
                  <th>ড্রাইভারের নাম ও ফোন</th>
                  <th>গন্তব্য / মোকাম</th>
                  <th className="text-right">পণ্য ও পরিমাণ</th>
                  <th className="text-right">ট্রিপ ভাড়া</th>
                  <th className="text-right">পরিশোধিত</th>
                  <th className="text-center">স্ট্যাটাস</th>
                  <th className="text-center">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((t) => {
                  const fare = Number(t.tripFare);
                  const paid = Number(t.paidAmount);
                  const isPaid = t.paymentStatus === "PAID";
                  const isPartial = t.paymentStatus === "PARTIAL";

                  return (
                    <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="whitespace-nowrap font-medium text-slate-700">
                        {formatDate(t.date)}
                      </td>
                      <td>
                        {t.voucher ? (
                          <Link
                            prefetch={false}
                            href={`/vouchers/v/${t.voucher.id}`}
                            className="font-bold text-brand-700 hover:underline block"
                          >
                            {t.voucher.voucherNo}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        <span className="text-[11px] text-slate-500 block truncate max-w-[150px]">
                          {t.voucher?.partyAccount?.name || "ওয়াক-ইন"}
                        </span>
                      </td>
                      <td className="font-semibold text-slate-900 whitespace-nowrap">
                        {t.vehicleNo}
                      </td>
                      <td>
                        <span className="font-medium text-slate-800 block">
                          {t.driverName}
                        </span>
                        {t.driverMobile && (
                          <span className="text-[11px] text-slate-500 block">
                            {t.driverMobile}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[180px] truncate" title={t.destination || ""}>
                        {t.destination || "—"}
                      </td>
                      <td className="text-right text-xs">
                        <span className="font-bold text-slate-800 block">
                          {t.totalQuantity ? `${toBnDigits(Number(t.totalQuantity))} ইউনিট` : "—"}
                        </span>
                        {t.goodsSummary && (
                          <span className="text-[10px] text-slate-500 block truncate max-w-[140px]" title={t.goodsSummary}>
                            {t.goodsSummary}
                          </span>
                        )}
                      </td>
                      <td className="text-right font-bold text-slate-900 whitespace-nowrap">
                        {formatMoney(fare, currency)}
                      </td>
                      <td className="text-right font-medium text-emerald-700 whitespace-nowrap">
                        {formatMoney(paid, currency)}
                      </td>
                      <td className="text-center">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                            isPaid
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : isPartial
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-rose-50 text-rose-700 border border-rose-200"
                          }`}
                        >
                          {isPaid ? "পরিশোধিত" : isPartial ? "আংশিক" : "বকেয়া"}
                        </span>
                      </td>
                      <td className="text-center whitespace-nowrap">
                        {!isPaid && (
                          <button
                            type="button"
                            className="btn-ghost btn-xs text-xs text-brand-700 font-semibold hover:bg-brand-50"
                            onClick={() => openPaymentModal(t.driverName)}
                          >
                            পরিশোধ
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pay Driver Fare Modal */}
      {payModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="panel max-w-lg w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <span>৳</span>
                <span>ড্রাইভার ট্রিপ ভাড়া পরিশোধ</span>
              </h3>
              <button
                type="button"
                className="btn-ghost btn-sm text-slate-400 hover:text-slate-600"
                onClick={() => setPayModalOpen(false)}
              >
                ✕
              </button>
            </div>

            {payError && (
              <div className="rounded-md bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-800">
                {payError}
              </div>
            )}

            <form onSubmit={handlePaySubmit} className="space-y-3">
              <div>
                <label className="label text-xs" htmlFor="m-driver-name">
                  ড্রাইভারের নাম *
                </label>
                <input
                  id="m-driver-name"
                  name="driverName"
                  type="text"
                  className="input text-sm"
                  value={payDriverName}
                  onChange={(e) => {
                    const name = e.target.value;
                    setPayDriverName(name);
                    const matched = uniqueDrivers.find((x) => x.driverName.toLowerCase() === name.trim().toLowerCase());
                    if (matched?.driverMobile) setPayDriverMobile(matched.driverMobile);
                  }}
                  required
                  placeholder="ড্রাইভারের নাম"
                />
              </div>

              <div>
                <label className="label text-xs" htmlFor="m-driver-mobile">
                  মোবাইল নম্বর
                </label>
                <input
                  id="m-driver-mobile"
                  name="driverMobile"
                  type="text"
                  className="input text-sm"
                  value={payDriverMobile}
                  onChange={(e) => setPayDriverMobile(e.target.value)}
                  placeholder="০১৭১১..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs" htmlFor="m-amount">
                    পরিশোধের পরিমাণ ({currency}) *
                  </label>
                  <input
                    id="m-amount"
                    name="amount"
                    type="text"
                    inputMode="decimal"
                    data-numeric
                    className="input text-sm font-bold text-slate-900"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    required
                    placeholder="০.০০"
                  />
                </div>
                <div>
                  <label className="label text-xs" htmlFor="m-date">
                    তারিখ *
                  </label>
                  <input
                    id="m-date"
                    name="date"
                    type="date"
                    className="input text-sm"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="label text-xs" htmlFor="m-cash-acc">
                  পেমেন্ট ক্যাশ / ব্যাংক হিসাব *
                </label>
                <select
                  id="m-cash-acc"
                  name="cashAccountId"
                  className="input text-sm"
                  value={payCashAccountId}
                  onChange={(e) => setPayCashAccountId(e.target.value)}
                  required
                >
                  {paymentAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.group}) {a.balance !== undefined ? `— ${formatMoney(a.balance, currency)}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label text-xs" htmlFor="m-ref">
                  রেফারেন্স / রসিদ নং
                </label>
                <input
                  id="m-ref"
                  name="reference"
                  type="text"
                  className="input text-sm"
                  value={payReference}
                  onChange={(e) => setPayReference(e.target.value)}
                  placeholder="যেমন: ভাউচার বা মানি রসিদ নম্বর"
                />
              </div>

              <div>
                <label className="label text-xs" htmlFor="m-notes">
                  মন্তব্য / নোট
                </label>
                <input
                  id="m-notes"
                  name="notes"
                  type="text"
                  className="input text-sm"
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="যেমন: দিনাজপুর মোকাম ট্রিপ ভাড়া বাবদ পরিশোধ"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => setPayModalOpen(false)}
                >
                  বাতিল
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="btn-primary text-sm"
                >
                  {isPending ? "সংরক্ষণ হচ্ছে..." : "পরিশোধ নিশ্চিত করুন"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Company Vehicles Management Modal */}
      {vehicleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="panel max-w-xl w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <span>🚗</span>
                <span>কোম্পানির নিজস্ব গাড়ি ও ড্রাইভার ব্যবস্থাপনা</span>
              </h3>
              <button
                type="button"
                className="btn-ghost btn-sm text-slate-400 hover:text-slate-600"
                onClick={() => setVehicleModalOpen(false)}
              >
                ✕
              </button>
            </div>

            {vehicleError && (
              <div className="rounded-md bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-800">
                {vehicleError}
              </div>
            )}

            {/* Vehicle Form */}
            <form onSubmit={handleVehicleSubmit} className="space-y-3 bg-slate-50/70 p-3.5 rounded-lg border">
              <h4 className="text-xs font-bold text-slate-700">
                {editVehicleId ? "গাড়ির তথ্য সংশোধন করুন" : "নতুন গাড়ি যোগ করুন"}
              </h4>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="label text-xs" htmlFor="v-no">গাড়ির নম্বর *</label>
                  <input
                    id="v-no"
                    name="vehicleNo"
                    type="text"
                    className="input text-xs"
                    value={vehicleNo}
                    onChange={(e) => setVehicleNo(e.target.value)}
                    required
                    placeholder="যেমন: ঢাকা মেট্রো-ট ১১-২২৩৩"
                  />
                </div>
                <div>
                  <label className="label text-xs" htmlFor="v-mod">মডেল / গাড়ির ধরন</label>
                  <input
                    id="v-mod"
                    name="model"
                    type="text"
                    className="input text-xs"
                    value={vehicleModel}
                    onChange={(e) => setVehicleModel(e.target.value)}
                    placeholder="যেমন: টাটা ৭ টন ট্রাক"
                  />
                </div>
                <div>
                  <label className="label text-xs" htmlFor="v-dname">নির্ধারিত ড্রাইভারের নাম</label>
                  <input
                    id="v-dname"
                    name="driverName"
                    type="text"
                    className="input text-xs"
                    value={vDriverName}
                    onChange={(e) => setVDriverName(e.target.value)}
                    placeholder="যেমন: রফিক ইসলাম"
                  />
                </div>
                <div>
                  <label className="label text-xs" htmlFor="v-dmob">ড্রাইভারের মোবাইল</label>
                  <input
                    id="v-dmob"
                    name="driverMobile"
                    type="text"
                    className="input text-xs"
                    value={vDriverMobile}
                    onChange={(e) => setVDriverMobile(e.target.value)}
                    placeholder="০১৭১১..."
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                {editVehicleId && (
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-xs"
                    onClick={() => openVehicleModal()}
                  >
                    নতুন যোগ করুন
                  </button>
                )}
                <button type="submit" disabled={isPending} className="btn-primary btn-sm text-xs">
                  {isPending ? "সংরক্ষণ হচ্ছে..." : editVehicleId ? "আপডেট করুন" : "যোগ করুন"}
                </button>
              </div>
            </form>

            {/* Existing Vehicles List */}
            <div className="space-y-2 max-h-60 overflow-y-auto">
              <h4 className="text-xs font-bold text-slate-700">সংরক্ষিত গাড়ির তালিকা</h4>
              {companyVehicles.length === 0 ? (
                <p className="text-xs text-slate-400 py-3 text-center">এখনও কোনো কোম্পানির গাড়ি যোগ করা হয়নি</p>
              ) : (
                <div className="divide-y divide-slate-100 border rounded-md">
                  {companyVehicles.map((v) => (
                    <div key={v.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-slate-50">
                      <div>
                        <span className="font-bold text-slate-900 block">{v.vehicleNo}</span>
                        <span className="text-slate-500 text-[11px] block">
                          {v.model ? `${v.model} · ` : ""}
                          {v.driverName ? `ড্রাইভার: ${v.driverName} (${v.driverMobile || "ফোন নেই"})` : "কোনো ড্রাইভার যুক্ত নেই"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="btn-ghost btn-xs text-brand-700"
                          onClick={() => openVehicleModal(v)}
                        >
                          সম্পাদনা
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-xs text-rose-600 hover:bg-rose-50"
                          onClick={() => handleDeleteVehicle(v.id)}
                        >
                          মুছুন
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t">
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setVehicleModalOpen(false)}
              >
                বন্ধ করুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

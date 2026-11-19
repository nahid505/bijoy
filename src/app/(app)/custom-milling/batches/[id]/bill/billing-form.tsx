"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { saveBatchBillingAction } from "@/server/actions/custom-milling";
import type { MillRoleType } from "@/lib/custom-milling";
import { formatNumber } from "@/lib/format";

interface BatchData {
  id: string;
  batchNo: string;
  standardBags75Kg: number;
  dryerRatePerBag: number;
  millingRatePerBag: number;
  riceOutputBags: number;
  branKg: number;
  huskKg: number;
  byProductKeptMill: boolean;
  totalBillAmount: number;
  status: string;
}

export function BillingForm({
  batch,
  defaultDryerRate,
  defaultMillingRate,
  defaultBranRate,
  defaultHuskRate,
  role,
}: {
  batch: BatchData;
  defaultDryerRate: number;
  defaultMillingRate: number;
  defaultBranRate: number;
  defaultHuskRate: number;
  role: MillRoleType;
}) {
  const stdBags = Number(batch.standardBags75Kg) || 0;

  const [dryerRate, setDryerRate] = useState<number | "">(batch.dryerRatePerBag || defaultDryerRate);
  const [millingRate, setMillingRate] = useState<number | "">(batch.millingRatePerBag || defaultMillingRate);
  const [riceOutputBags, setRiceOutputBags] = useState<number | "">(batch.riceOutputBags || 0);
  const [branKg, setBranKg] = useState<number | "">(batch.branKg || 0);
  const [branRate, setBranRate] = useState<number | "">(defaultBranRate);
  const [huskKg, setHuskKg] = useState<number | "">(batch.huskKg || 0);
  const [huskRate, setHuskRate] = useState<number | "">(defaultHuskRate);
  const [byProductKeptMill, setByProductKeptMill] = useState(batch.byProductKeptMill ?? true);
  const [markDelivered, setMarkDelivered] = useState(batch.status === "DELIVERED");

  // Calculations
  const dRate = Number(dryerRate) || 0;
  const mRate = Number(millingRate) || 0;
  const bKg = Number(branKg) || 0;
  const bRate = Number(branRate) || 0;
  const hKg = Number(huskKg) || 0;
  const hRate = Number(huskRate) || 0;

  const dryerFee = Number((stdBags * dRate).toFixed(2));
  const millingFee = Number((stdBags * mRate).toFixed(2));
  const byProductIncome = byProductKeptMill
    ? Number((bKg * bRate + hKg * hRate).toFixed(2))
    : 0;
  const totalBill = Number((dryerFee + millingFee + byProductIncome).toFixed(2));

  return (
    <div className="space-y-6">
      <ActionForm
        action={saveBatchBillingAction.bind(null, batch.id)}
        className="space-y-6 no-print"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="ড্রায়ার শুকানো দর (টাকা/৭৫ কেজি বস্তা)"
            name="dryerRatePerBag"
            hint={`মোট ড্রায়ার ফি = ${stdBags} বস্তা × ৳${dRate} = ৳${dryerFee}`}
          >
            <input
              id="dryerRatePerBag"
              name="dryerRatePerBag"
              type="number"
              step="1"
              min="0"
              value={dryerRate}
              onChange={(e) => setDryerRate(e.target.value === "" ? "" : Number(e.target.value))}
              className="input-num text-base font-bold text-ink-900"
              required
            />
          </Field>

          <Field
            label="মিলিং প্রসেসিং দর (টাকা/৭৫ কেজি বস্তা)"
            name="millingRatePerBag"
            hint={`মোট মিলিং ফি = ${stdBags} বস্তা × ৳${mRate} = ৳${millingFee}`}
          >
            <input
              id="millingRatePerBag"
              name="millingRatePerBag"
              type="number"
              step="1"
              min="0"
              value={millingRate}
              onChange={(e) => setMillingRate(e.target.value === "" ? "" : Number(e.target.value))}
              className="input-num text-base font-bold text-ink-900"
              required
            />
          </Field>
        </div>

        {/* Rice & By-Product Section */}
        <div className="rounded-xl border border-rule bg-slate-50/70 p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-rule pb-2">
            <span className="text-lg">🌾</span>
            <h3 className="text-sm font-bold text-ink-900">উৎপাদিত চাল ও উপজাত (কুঁড়া/ভূসি)</h3>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="উৎপাদিত চালের বস্তা" name="riceOutputBags" hint="ডেলিভারিকৃত চালের সংখ্যা">
              <input
                id="riceOutputBags"
                name="riceOutputBags"
                type="number"
                min="0"
                value={riceOutputBags}
                onChange={(e) => setRiceOutputBags(e.target.value === "" ? "" : Number(e.target.value))}
                className="input-num font-bold"
              />
            </Field>

            <Field label="কুঁড়া (Bran KG)" name="branKg" hint={`দর: ৳${bRate}/kg · আয়: ৳${(bKg * bRate).toFixed(2)}`}>
              <input
                id="branKg"
                name="branKg"
                type="number"
                step="0.5"
                min="0"
                value={branKg}
                onChange={(e) => setBranKg(e.target.value === "" ? "" : Number(e.target.value))}
                className="input-num font-bold"
              />
              <input type="hidden" name="branRatePerKg" value={bRate} />
            </Field>

            <Field label="ভূসি / তুষ (Husk KG)" name="huskKg" hint={`দর: ৳${hRate}/kg · আয়: ৳${(hKg * hRate).toFixed(2)}`}>
              <input
                id="huskKg"
                name="huskKg"
                type="number"
                step="0.5"
                min="0"
                value={huskKg}
                onChange={(e) => setHuskKg(e.target.value === "" ? "" : Number(e.target.value))}
                className="input-num font-bold"
              />
              <input type="hidden" name="huskRatePerKg" value={hRate} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                name="byProductKeptMill"
                checked={byProductKeptMill}
                onChange={(e) => setByProductKeptMill(e.target.checked)}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 h-4 w-4"
              />
              <span>উপজাত (কুঁড়া ও ভূসি) মিল রেখে দিচ্ছে (মিলের রাজস্ব আয়)</span>
            </label>

            <label className="flex items-center gap-2 text-sm font-semibold text-emerald-800 cursor-pointer">
              <input
                type="checkbox"
                name="markDelivered"
                checked={markDelivered}
                onChange={(e) => setMarkDelivered(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4"
              />
              <span>ডেলিভারি সম্পন্ন হিসেবে চিহ্নিত করুন</span>
            </label>
          </div>
        </div>

        {/* Live Bill Amount Box */}
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
              সর্বমোট মিলিং বিল
            </p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <p className="text-3xl font-black text-emerald-950">৳ {formatNumber(totalBill)}</p>
              <span className="text-xs text-emerald-700">
                (ড্রায়ার: ৳{formatNumber(dryerFee)} + মিলিং: ৳{formatNumber(millingFee)} {byProductIncome > 0 ? `+ উপজাত: ৳${formatNumber(byProductIncome)}` : ""})
              </span>
            </div>
          </div>

          {role !== "MILL_PARTNER" && (
            <SubmitButton pendingText="সংরক্ষণ হচ্ছে…">
              ✓ বিল সংরক্ষণ করুন
            </SubmitButton>
          )}
        </div>
      </ActionForm>
    </div>
  );
}

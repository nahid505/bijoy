"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton } from "@/components/forms";
import { createBatchAction } from "@/server/actions/custom-milling";
import type { MillRoleType } from "@/lib/custom-milling";

interface PartyOption {
  id: string;
  name: string;
  phone: string | null;
  isOwnerSelfParty: boolean;
}

export function WeighbridgeForm({
  parties,
  defaultDhaltaPerBag,
  bagStandardKg,
  role,
}: {
  parties: PartyOption[];
  defaultDhaltaPerBag: number;
  bagStandardKg: number;
  role: MillRoleType;
}) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(todayStr);
  const [partyId, setPartyId] = useState(parties[0]?.id ?? "");
  const [physicalBags, setPhysicalBags] = useState<number | "">(100);
  const [grossWeightKg, setGrossWeightKg] = useState<number | "">(8500);
  const [tareWeightKg, setTareWeightKg] = useState<number | "">(800);
  const [dhaltaPerBagKg, setDhaltaPerBagKg] = useState<number | "">(defaultDhaltaPerBag);

  // Live calculations
  const bagsNum = Number(physicalBags) || 0;
  const grossNum = Number(grossWeightKg) || 0;
  const tareNum = Number(tareWeightKg) || 0;
  const dhaltaRateNum = Number(dhaltaPerBagKg) || 0;
  const stdBagKg = Number(bagStandardKg) > 0 ? Number(bagStandardKg) : 75.0;

  const totalDhaltaKg = Number((bagsNum * dhaltaRateNum).toFixed(2));
  const grossMinusTare = Math.max(0, grossNum - tareNum);
  const netWeightKg = Number(Math.max(0, grossMinusTare - totalDhaltaKg).toFixed(2));
  const standardBags75Kg = Number((netWeightKg / stdBagKg).toFixed(2));

  const selectedParty = parties.find((p) => p.id === partyId);

  return (
    <ActionForm action={createBatchAction} className="space-y-6">
      {/* Date & Party Selection */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="তারিখ (Date)"
          name="date"
          hint={
            role === "MILL_ACCOUNTANT"
              ? "হিসাবরক্ষক হিসেবে শুধুমাত্র আজকের তারিখ গ্রহণযোগ্য"
              : "সুপার অ্যাডমিন পেছনের তারিখেও এন্ট্রি করতে পারেন"
          }
        >
          <input
            id="date"
            name="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            readOnly={role === "MILL_ACCOUNTANT"}
            className={`input ${role === "MILL_ACCOUNTANT" ? "bg-slate-100 cursor-not-allowed" : ""}`}
            required
          />
        </Field>

        <Field
          label="পার্টি নির্বাচন করুন"
          name="partyId"
          hint={selectedParty?.isOwnerSelfParty ? "★ এটি নিজস্ব পার্টির ধান (নাহিদ হাসান) — মূল ব্যবসায় সিঙ্ক হবে" : undefined}
        >
          <select
            id="partyId"
            name="partyId"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            className="input"
            required
          >
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.isOwnerSelfParty ? "★ [নিজস্ব পার্টি - নাহিদ হাসান]" : ""} {p.phone ? `(${p.phone})` : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Paddy & Vehicle Details */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ধানের জাত / প্রকার" name="paddyType" hint="উদাঃ ব্রি-২৮, মিনিকেট, স্বর্ণা, কাটারিভোগ, জিরাশাইল">
          <input
            id="paddyType"
            name="paddyType"
            defaultValue="ব্রি-২৮"
            placeholder="ব্রি-২৮ / মিনিকেট / স্বর্ণা"
            className="input"
            required
          />
        </Field>

        <Field label="গাড়ির নম্বর / ট্রলি নং" name="vehicleNo" hint="ট্রাক বা ট্রলি নম্বর (ঐচ্ছিক)">
          <input
            id="vehicleNo"
            name="vehicleNo"
            placeholder="ঢাকা মেট্রো-ট-১১-XXXX"
            className="input"
          />
        </Field>
      </div>

      {/* Weighbridge Weights Section */}
      <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 space-y-4">
        <div className="flex items-center gap-2 border-b border-sky-200 pb-2">
          <span className="text-lg">⚖️</span>
          <h3 className="text-sm font-bold text-sky-950">স্কেলের ওজন ও বস্তা হিসাব</h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="মোট বস্তা সংখ্যা (Physical Bags)" name="physicalBags">
            <input
              id="physicalBags"
              name="physicalBags"
              type="number"
              min="1"
              value={physicalBags}
              onChange={(e) => setPhysicalBags(e.target.value === "" ? "" : Number(e.target.value))}
              className="input-num text-base font-bold"
              required
            />
          </Field>

          <Field label="গ্রস ওজন (Gross Weight KG)" name="grossWeightKg" hint="ধানসহ গাড়ির মোট ওজন">
            <input
              id="grossWeightKg"
              name="grossWeightKg"
              type="number"
              step="0.5"
              min="0"
              value={grossWeightKg}
              onChange={(e) => setGrossWeightKg(e.target.value === "" ? "" : Number(e.target.value))}
              className="input-num text-base font-bold text-ink-900"
              required
            />
          </Field>

          <Field label="খালি গাড়ির ওজন (Tare Weight KG)" name="tareWeightKg" hint="গাড়ির খালি ওজন">
            <input
              id="tareWeightKg"
              name="tareWeightKg"
              type="number"
              step="0.5"
              min="0"
              value={tareWeightKg}
              onChange={(e) => setTareWeightKg(e.target.value === "" ? "" : Number(e.target.value))}
              className="input-num text-base font-bold text-slate-600"
              required
            />
          </Field>

          <Field label="ঢলতা প্রতি বস্তা (KG)" name="dhaltaPerBagKg" hint="ডিফল্ট ১.৫ কেজি">
            <input
              id="dhaltaPerBagKg"
              name="dhaltaPerBagKg"
              type="number"
              step="0.1"
              min="0"
              value={dhaltaPerBagKg}
              onChange={(e) => setDhaltaPerBagKg(e.target.value === "" ? "" : Number(e.target.value))}
              className="input-num text-base font-bold text-amber-700"
            />
          </Field>
        </div>

        {/* Real-Time Live Calculation Display */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-sky-300 bg-white p-3.5 shadow-xs">
          <div>
            <p className="text-[11px] font-semibold text-slate-500">ধানের মোট ওজন (গ্রস - খালি)</p>
            <p className="text-base font-mono font-bold text-ink-900">{grossMinusTare.toFixed(2)} kg</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-amber-800">মোট ঢলতা কাটা ({dhaltaRateNum} kg/বস্তা)</p>
            <p className="text-base font-mono font-bold text-amber-800">-{totalDhaltaKg.toFixed(2)} kg</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-emerald-800">মোট নেট ওজন (Net Weight)</p>
            <p className="text-lg font-mono font-extrabold text-emerald-900">{netWeightKg.toFixed(2)} kg</p>
          </div>
          <div className="rounded-lg bg-brand-50 border border-brand-300 p-2 text-center">
            <p className="text-[11px] font-bold text-brand-900">৭৫ কেজি স্ট্যান্ডার্ড বস্তা</p>
            <p className="text-2xl font-black text-brand-700">{standardBags75Kg}</p>
            <span className="text-[10px] text-brand-800 font-medium">({netWeightKg} ÷ {stdBagKg})</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <SubmitButton pendingText="সংরক্ষণ হচ্ছে…">
          ✓ স্কেল এন্ট্রি সংরক্ষণ করুন
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ActionForm, Field, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { EntryDateInput } from "@/components/entry-date-input";
import { SearchSelect } from "@/components/search-select";
import type { PartyOption } from "@/components/trade-parts";
import { toBnDigits } from "@/lib/format";
import { useT } from "@/components/lang";
import { fetchSupplierBagBalanceAction } from "@/server/actions/bag-return";
import type { SupplierBagBalance } from "@/server/services/bag-tracking";

export interface BagReturnDefaults {
  date: string;
  supplier: PartyOption | null;
  returnedJuteBags: string;
  returnedPlasticBags: string;
  driverName: string;
  vehicleNo: string;
  note: string;
}

export function BagReturnForm({
  action,
  defaults,
  initialBalance,
  dateLocked,
}: {
  action: FormAction;
  defaults: BagReturnDefaults;
  initialBalance?: SupplierBagBalance | null;
  dateLocked?: boolean;
}) {
  const t = useT();
  const [f, setF] = useState(defaults);
  const [balance, setBalance] = useState<SupplierBagBalance | null>(initialBalance ?? null);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof BagReturnDefaults>(k: K, v: BagReturnDefaults[K]) =>
    setF((x) => ({ ...x, [k]: v }));

  const handleSupplierChange = (s: PartyOption | null) => {
    set("supplier", s);
    if (s?.id) {
      startTransition(async () => {
        const bal = await fetchSupplierBagBalanceAction(s.id);
        setBalance(bal);
      });
    } else {
      setBalance(null);
    }
  };

  const juteNum = Number(f.returnedJuteBags) || 0;
  const plasticNum = Number(f.returnedPlasticBags) || 0;
  const totalReturned = juteNum + plasticNum;

  const payload = JSON.stringify({
    date: f.date,
    supplierId: f.supplier?.id ?? "",
    returnedJuteBags: juteNum,
    returnedPlasticBags: plasticNum,
    driverName: f.driverName || null,
    vehicleNo: f.vehicleNo || null,
    note: f.note || null,
  });

  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="তারিখ *" name="date">
          <EntryDateInput id="date" value={f.date} onChange={(v) => set("date", v)} locked={dateLocked} />
        </Field>

        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium text-ink-800" htmlFor="supplier">
            {t("সরবরাহকারী (কৃষক / ব্যাপারী) *")}
          </label>
          <SearchSelect
            kind="suppliers"
            id="supplier"
            value={f.supplier}
            onChange={handleSupplierChange}
            placeholder={t("নাম বা মোবাইল দিয়ে সরবরাহকারী খুঁজুন")}
            create={{}}
          />
          <FieldError name="supplierId" />
        </div>
      </div>

      {/* বকেয়া বস্তা ব্যালেন্স কার্ড (Supplier Bag Balance Summary Card) */}
      {f.supplier && (
        <section
          className="rounded-lg border-2 border-amber-300 bg-amber-50/70 p-4 shadow-xs"
          aria-label="সরবরাহকারীর খালি বস্তা ব্যালেন্স"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 pb-2">
            <div>
              <h3 className="text-sm font-bold text-amber-950">
                📦 সরবরাহকারীর বকেয়া বস্তা পাওনা হিসাব — {f.supplier.name}
              </h3>
              <p className="text-xs text-amber-800">
                ধান ক্রয়ের সময় গৃহীত মোট বস্তা থেকে এযাবৎ ফেরত দেওয়া বস্তার হিসাব
              </p>
            </div>
            {isPending && <span className="text-xs font-medium text-amber-700 animate-pulse">হিসাব লোড হচ্ছে...</span>}
          </div>

          {balance ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-amber-200 bg-white p-3 shadow-2xs">
                  <span className="text-xs text-slate-500">অবশিষ্ট চটের বস্তা পাওনা</span>
                  <p className="text-xl font-bold text-ink-900 tabular-nums">
                    {toBnDigits(balance.dueJuteBags)}{" "}
                    <span className="text-xs font-normal text-slate-500">টি</span>
                  </p>
                  <span className="text-[11px] text-slate-400">
                    গৃহীত {toBnDigits(balance.receivedJuteBags)} − ফেরত {toBnDigits(balance.returnedJuteBags)}
                  </span>
                </div>

                <div className="rounded-md border border-amber-200 bg-white p-3 shadow-2xs">
                  <span className="text-xs text-slate-500">অবশিষ্ট প্লাস্টিক বস্তা পাওনা</span>
                  <p className="text-xl font-bold text-ink-900 tabular-nums">
                    {toBnDigits(balance.duePlasticBags)}{" "}
                    <span className="text-xs font-normal text-slate-500">টি</span>
                  </p>
                  <span className="text-[11px] text-slate-400">
                    গৃহীত {toBnDigits(balance.receivedPlasticBags)} − ফেরত {toBnDigits(balance.returnedPlasticBags)}
                  </span>
                </div>

                <div className="col-span-2 sm:col-span-1 rounded-md border-2 border-amber-400 bg-amber-100/60 p-3 shadow-2xs">
                  <span className="text-xs font-semibold text-amber-900">মোট অবশিষ্ট বস্তা পাওনা</span>
                  <p className="text-2xl font-black text-amber-950 tabular-nums">
                    {toBnDigits(balance.dueTotalBags)}{" "}
                    <span className="text-sm font-normal text-amber-900">টি</span>
                  </p>
                  <span className="text-[11px] text-amber-800 font-medium">
                    মোট গৃহীত {toBnDigits(balance.receivedTotalBags)} − ফেরত {toBnDigits(balance.returnedTotalBags)}
                  </span>
                </div>
              </div>

              {/* কুইক অ্যাকশন বাটনসমূহ */}
              {(balance.dueJuteBags > 0 || balance.duePlasticBags > 0) && (
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <span className="text-slate-600 font-medium">সহজে পূরণ করুন:</span>
                  {balance.dueJuteBags > 0 && (
                    <button
                      type="button"
                      onClick={() => set("returnedJuteBags", String(balance.dueJuteBags))}
                      className="rounded bg-white px-2 py-1 font-semibold text-amber-800 border border-amber-300 hover:bg-amber-100"
                    >
                      সব চটের বস্তা ({toBnDigits(balance.dueJuteBags)})
                    </button>
                  )}
                  {balance.duePlasticBags > 0 && (
                    <button
                      type="button"
                      onClick={() => set("returnedPlasticBags", String(balance.duePlasticBags))}
                      className="rounded bg-white px-2 py-1 font-semibold text-amber-800 border border-amber-300 hover:bg-amber-100"
                    >
                      সব প্লাস্টিক বস্তা ({toBnDigits(balance.duePlasticBags)})
                    </button>
                  )}
                  {balance.dueJuteBags > 0 && balance.duePlasticBags > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        set("returnedJuteBags", String(balance.dueJuteBags));
                        set("returnedPlasticBags", String(balance.duePlasticBags));
                      }}
                      className="rounded bg-amber-800 px-2 py-1 font-semibold text-white hover:bg-amber-900"
                    >
                      সব বস্তা একসাথে ফেরত
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">বকেয়া বস্তার হিসাব লোড হচ্ছে...</p>
          )}
        </section>
      )}

      {/* বস্তা ফেরত ইনপুট সেকশন */}
      <section className="rounded-lg border border-rule p-4" aria-label="ফেরত বস্তার সংখ্যা">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">ফেরত দেওয়া খালি বস্তার হিসাব</h2>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="১. ফেরত চটের বস্তা (সংখ্যা) *" name="returnedJuteBags" hint="চটের খালি বস্তা ফেরত">
            <input
              id="returnedJuteBags"
              className="input-num text-lg font-bold"
              inputMode="numeric"
              data-numeric
              value={f.returnedJuteBags}
              onChange={(e) => set("returnedJuteBags", e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="০"
            />
          </Field>

          <Field label="২. ফেরত প্লাস্টিক বস্তা (সংখ্যা) *" name="returnedPlasticBags" hint="প্লাস্টিক খালি বস্তা ফেরত">
            <input
              id="returnedPlasticBags"
              className="input-num text-lg font-bold"
              inputMode="numeric"
              data-numeric
              value={f.returnedPlasticBags}
              onChange={(e) => set("returnedPlasticBags", e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="০"
            />
          </Field>

          <div className="flex flex-col justify-center rounded-md border-2 border-emerald-300 bg-emerald-50/60 p-3 shadow-2xs">
            <span className="text-xs font-semibold text-emerald-900">মোট ফেরত বস্তা (স্বয়ংক্রিয়)</span>
            <output id="totalReturned" className="text-2xl font-black text-emerald-800 tabular-nums">
              {toBnDigits(totalReturned)} <span className="text-sm font-normal text-emerald-700">টি</span>
            </output>
            <span className="text-[11px] text-emerald-700">
              চট: {toBnDigits(juteNum)} টি + প্লাস্টিক: {toBnDigits(plasticNum)} টি
            </span>
          </div>
        </div>
      </section>

      {/* পরিবহন ও ড্রাইভারের তথ্য */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="গাড়ি ও ড্রাইভারের তথ্য">
        <Field label="ড্রাইভারের নাম" name="driverName" hint="বস্তা বহনকারী ড্রাইভারের নাম">
          <input
            id="driverName"
            className="input"
            maxLength={100}
            value={f.driverName}
            onChange={(e) => set("driverName", e.target.value)}
            placeholder="যেমন: মো: রফিকুল ইসলাম"
          />
        </Field>

        <Field label="গাড়ি / ট্র্যাক্টর নম্বর" name="vehicleNo" hint="যানবাহনের নম্বর বা ভ্যান/ট্রলি">
          <input
            id="vehicleNo"
            className="input"
            maxLength={60}
            value={f.vehicleNo}
            onChange={(e) => set("vehicleNo", e.target.value)}
            placeholder="যেমন: ঢাকা মেট্রো-ট ১১-২২৩৩"
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="নোট / মন্তব্য" name="note" hint="চালানের বিশেষ কোনো বিবরণ বা নোট থাকলে লিখুন">
            <textarea
              id="note"
              className="input min-h-[60px]"
              maxLength={500}
              value={f.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="মন্তব্য লিখুন..."
            />
          </Field>
        </div>
      </section>

      <div className="flex gap-2 pt-2">
        <SubmitButton>{t("বস্তা ফেরত চালান সংরক্ষণ করুন")}</SubmitButton>
        <Link prefetch={false} href="/auto-rice-mill/bag-returns" className="btn-secondary">
          {t("বাতিল")}
        </Link>
      </div>
    </ActionForm>
  );
}

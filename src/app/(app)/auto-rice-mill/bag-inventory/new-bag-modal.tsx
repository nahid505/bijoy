"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { savePackagingBagItemAction } from "@/server/actions/packaging-bag";

const BAG_TYPES = [
  { value: "BAG_50KG", label: "৫০ কেজি বস্তা", capacity: 50 },
  { value: "BAG_25KG", label: "২৫ কেজি বস্তা", capacity: 25 },
  { value: "BAG_10KG", label: "১০ কেজি বস্তা", capacity: 10 },
  { value: "BAG_5KG", label: "৫ কেজি বস্তা", capacity: 5 },
  { value: "OTHER", label: "অন্যান্য মাপ", capacity: 50 },
] as const;

export function NewBagModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [bagType, setBagType] = useState<typeof BAG_TYPES[number]["value"]>("BAG_50KG");
  const [capacityKg, setCapacityKg] = useState<number>(50);
  const [material, setMaterial] = useState("প্লাস্টিক / ওভেন ব্যাগ");
  const [brandName, setBrandName] = useState("");
  const [purchasePrice, setPurchasePrice] = useState<number | "">(45);
  const [openingStock, setOpeningStock] = useState<number | "">(0);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (isOpen) {
      ref.current?.showModal();
      setMessage(null);
      setErrors({});
    } else {
      ref.current?.close();
    }
  }, [isOpen]);

  const handleTypeChange = (typeVal: typeof BAG_TYPES[number]["value"]) => {
    setBagType(typeVal);
    const found = BAG_TYPES.find((t) => t.value === typeVal);
    if (found && typeVal !== "OTHER") {
      setCapacityKg(found.capacity);
      if (!name || BAG_TYPES.some((t) => name.includes(t.label))) {
        setName(`${found.label} (চালের বস্তা)`);
      }
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    if (!name.trim()) {
      setErrors({ name: ["বস্তার নাম দিন"] });
      return;
    }

    setBusy(true);
    setMessage(null);
    setErrors({});

    try {
      const fd = new FormData();
      fd.set(
        "payload",
        JSON.stringify({
          name: name.trim(),
          code: code.trim() || undefined,
          bagType,
          capacityKg: Number(capacityKg) || 50,
          material: material.trim() || undefined,
          brandName: brandName.trim() || undefined,
          purchasePrice: Number(purchasePrice) || 0,
          openingStock: Number(openingStock) || 0,
        }),
      );

      const r = await savePackagingBagItemAction(null, { ok: false }, fd);
      if (r?.ok) {
        onClose();
      } else {
        setMessage(r?.message || "সংরক্ষণ করা যায়নি");
        setErrors(r?.errors ?? {});
      }
    } catch {
      setMessage("সার্ভারে পৌঁছানো যায়নি — আবার চেষ্টা করুন");
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) => errors[k]?.[0];

  return createPortal(
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/60"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800">নতুন খালি চালের বস্তা যোগ</h3>
            <p className="text-xs text-slate-500">রাইস মিলের চাল প্যাকিংয়ের নতুন বস্তা টাইপ ইনভেন্টরিতে যুক্ত করুন</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        {message && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
            {message}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">বস্তার ধরন *</label>
            <select
              value={bagType}
              onChange={(e) => handleTypeChange(e.target.value as typeof BAG_TYPES[number]["value"])}
              className="input w-full"
            >
              {BAG_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">ধারণক্ষমতা (কেজি) *</label>
            <input
              type="number"
              step="0.5"
              min="1"
              value={capacityKg}
              onChange={(e) => setCapacityKg(Number(e.target.value))}
              className="input w-full"
              required
            />
            {err("capacityKg") && <p className="mt-1 text-xs text-red-600">{err("capacityKg")}</p>}
          </div>
        </div>

        <div>
          <label className="label">বস্তার নাম *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input w-full"
            placeholder="যেমন: মিনিকেট ৫০ কেজি চালের বস্তা"
            required
          />
          {err("name") && <p className="mt-1 text-xs text-red-600">{err("name")}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">বস্তার কোড (ঐচ্ছিক)</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input w-full"
              placeholder="যেমন: BAG-50KG-MINIKET"
            />
            {err("code") && <p className="mt-1 text-xs text-red-600">{err("code")}</p>}
          </div>

          <div>
            <label className="label">বস্তার উপাদান</label>
            <input
              type="text"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              className="input w-full"
              placeholder="যেমন: প্লাস্টিক বোভেন, নন-ওভেন, চট"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">ব্র্যান্ড / মার্কা</label>
            <input
              type="text"
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="input w-full"
              placeholder="যেমন: স্পেশাল মার্কা"
            />
          </div>

          <div>
            <label className="label">আনুমানিক ক্রয় দর (৳)</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value ? Number(e.target.value) : "")}
              className="input w-full"
              placeholder="যেমন: ৪৫"
            />
          </div>

          <div>
            <label className="label">প্রারম্ভিক মজুদ (পিস)</label>
            <input
              type="number"
              min="0"
              value={openingStock}
              onChange={(e) => setOpeningStock(e.target.value ? Number(e.target.value) : "")}
              className="input w-full"
              placeholder="০"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
            disabled={busy}
          >
            বাতিল
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy}
          >
            {busy ? "সংরক্ষণ হচ্ছে..." : "বস্তা যোগ করুন"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toBnDigits } from "@/lib/format";
import { recordPackagingBagWastageAction } from "@/server/actions/packaging-bag";

export interface BagItemOption {
  id: string;
  name: string;
  capacityKg: number;
  stock: number;
  unit: string;
}

export interface WarehouseOption {
  id: string;
  name: string;
}

const COMMON_REASONS = [
  "ছেঁড়া / ফাটা বস্তা",
  "প্রিন্টিং বা কালার ত্রুটি",
  "ইঁদুরে কাটা / ড্যামেজ",
  "লোড-আনলোড বা পরিবহন ক্ষতি",
  "আর্দ্রতা / পানিতে নষ্ট",
  "অন্যান্য",
];

export function WastageModal({
  isOpen,
  onClose,
  bagItems,
  warehouses,
}: {
  isOpen: boolean;
  onClose: () => void;
  bagItems: BagItemOption[];
  warehouses: WarehouseOption[];
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [bagItemId, setBagItemId] = useState(bagItems[0]?.id ?? "");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState<number | "">("");
  const [reason, setReason] = useState(COMMON_REASONS[0]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const selectedBag = bagItems.find((b) => b.id === bagItemId);

  useEffect(() => {
    if (isOpen) {
      ref.current?.showModal();
      setMessage(null);
      setErrors({});
    } else {
      ref.current?.close();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    if (!quantity || Number(quantity) <= 0) {
      setErrors({ quantity: ["নষ্ট বস্তার সংখ্যা কমপক্ষে ১ হতে হবে"] });
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
          bagItemId,
          warehouseId,
          date,
          quantity: Number(quantity),
          reason,
          notes,
        }),
      );

      const r = await recordPackagingBagWastageAction({ ok: false }, fd);
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
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-900/60"
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4" noValidate>
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800">নষ্ট / ছেঁড়া খালি বস্তা এন্ট্রি</h3>
            <p className="text-xs text-slate-500">গুদামে নষ্ট হওয়া বস্তার সংখ্যা বাদ দিন ও হিসাব সংরক্ষণ করুন</p>
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

        <div>
          <label className="label">খালি চালের বস্তা *</label>
          <select
            value={bagItemId}
            onChange={(e) => setBagItemId(e.target.value)}
            className="input w-full"
            required
          >
            {bagItems.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (মজুদ: {toBnDigits(b.stock)} {b.unit})
              </option>
            ))}
          </select>
          {selectedBag && (
            <p className="mt-1 text-xs text-slate-500">
              বর্তমান গুদাম মজুদ: <strong className="text-slate-700">{toBnDigits(selectedBag.stock)}</strong> {selectedBag.unit}
            </p>
          )}
          {err("bagItemId") && <p className="mt-1 text-xs text-red-600">{err("bagItemId")}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">গুদাম *</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="input w-full"
              required
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            {err("warehouseId") && <p className="mt-1 text-xs text-red-600">{err("warehouseId")}</p>}
          </div>

          <div>
            <label className="label">তারিখ *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input w-full"
              required
            />
            {err("date") && <p className="mt-1 text-xs text-red-600">{err("date")}</p>}
          </div>
        </div>

        <div>
          <label className="label">নষ্ট / ছেঁড়া বস্তার সংখ্যা (পিস) *</label>
          <input
            type="number"
            min={1}
            max={selectedBag ? Math.max(1, selectedBag.stock) : 100000}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : "")}
            className="input w-full"
            placeholder="যেমন: ১০"
            required
          />
          {err("quantity") && <p className="mt-1 text-xs text-red-600">{err("quantity")}</p>}
        </div>

        <div>
          <label className="label">নষ্টের কারণ</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input w-full"
          >
            {COMMON_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {err("reason") && <p className="mt-1 text-xs text-red-600">{err("reason")}</p>}
        </div>

        <div>
          <label className="label">মন্তব্য / বিবরণ (ঐচ্ছিক)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input w-full"
            rows={2}
            placeholder="অতিরিক্ত কোনো তথ্য থাকলে লিখুন..."
          />
          {err("notes") && <p className="mt-1 text-xs text-red-600">{err("notes")}</p>}
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
            {busy ? "সংরক্ষণ হচ্ছে..." : "নষ্ট বস্তা সংরক্ষণ করুন"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

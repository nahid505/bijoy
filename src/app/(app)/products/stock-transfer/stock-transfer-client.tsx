"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate, formatQty, toBn } from "@/lib/format";
import { saveStockTransferAction, deleteStockTransferAction } from "@/server/actions/stock-transfer";

export interface WarehouseOption {
  id: string;
  name: string;
  address?: string | null;
  isDefault: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
  code?: string | null;
  unit: { id: string; name: string };
  trackBatch?: boolean;
}

export interface TransferItemRow {
  productId: string;
  quantity: string | number;
  batchNo: string;
}

export interface SerializedTransferItem {
  id: string;
  productId: string;
  productName: string;
  productCode?: string | null;
  unitName: string;
  quantity: number;
  unitCost: number;
  batchNo?: string | null;
  lineNo: number;
}

export interface SerializedStockTransfer {
  id: string;
  transferNo: string;
  date: string;
  fromWarehouse: { id: string; name: string };
  toWarehouse: { id: string; name: string };
  vehicleNo?: string | null;
  driverName?: string | null;
  notes?: string | null;
  createdBy?: { id: string; name: string } | null;
  items: SerializedTransferItem[];
}

export function StockTransferClient({
  warehouses,
  products,
  stockMap,
  initialTransfers,
  canManage,
  initialDate,
}: {
  warehouses: WarehouseOption[];
  products: ProductOption[];
  stockMap: Record<string, number>;
  initialTransfers: SerializedStockTransfer[];
  canManage: boolean;
  initialDate: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form state
  const defaultFrom = warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "";
  const defaultTo = warehouses.find((w) => w.id !== defaultFrom)?.id ?? "";

  const [date, setDate] = useState(initialDate);
  const [fromWarehouseId, setFromWarehouseId] = useState(defaultFrom);
  const [toWarehouseId, setToWarehouseId] = useState(defaultTo);
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<TransferItemRow[]>([
    { productId: "", quantity: "", batchNo: "" },
  ]);

  // Status & Feedback
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Helper to query available stock in fromWarehouse
  const getAvailableStock = (whId: string, pId: string) => {
    if (!whId || !pId) return 0;
    return stockMap[`${whId}_${pId}`] ?? 0;
  };

  // Row handlers
  const handleItemChange = (index: number, field: keyof TransferItemRow, value: string | number) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addItemRow = () => {
    setItems((prev) => [...prev, { productId: "", quantity: "", batchNo: "" }]);
  };

  const removeItemRow = (index: number) => {
    if (items.length <= 1) {
      setItems([{ productId: "", quantity: "", batchNo: "" }]);
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!fromWarehouseId) {
      setErrorMsg("দয়া করে প্রেরক গুদাম নির্বাচন করুন।");
      return;
    }
    if (!toWarehouseId) {
      setErrorMsg("দয়া করে প্রাপক গুদাম নির্বাচন করুন।");
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setErrorMsg("প্রেরক ও প্রাপক গুদাম একই হতে পারবে না।");
      return;
    }

    // Filter valid rows
    const validItems = items.filter((i) => i.productId && Number(i.quantity) > 0);
    if (validItems.length === 0) {
      setErrorMsg("কমপক্ষে একটি পণ্য এবং সঠিক পরিমাণ নির্বাচন করুন।");
      return;
    }

    // Check stock availability
    for (const item of validItems) {
      const avail = getAvailableStock(fromWarehouseId, item.productId);
      const req = Number(item.quantity);
      const pr = products.find((p) => p.id === item.productId);
      if (req > avail) {
        setErrorMsg(
          `"${pr?.name ?? "পণ্য"}" এর পর্যাপ্ত মজুদ নেই! বর্তমান মজুদ: ${formatQty(avail)} ${pr?.unit.name ?? ""}, দিতে চেয়েছেন: ${formatQty(req)} ${pr?.unit.name ?? ""}`
        );
        return;
      }
    }

    const payload = {
      date,
      fromWarehouseId,
      toWarehouseId,
      vehicleNo: vehicleNo.trim() || undefined,
      driverName: driverName.trim() || undefined,
      notes: notes.trim() || undefined,
      items: validItems.map((i) => ({
        productId: i.productId,
        quantity: Number(i.quantity),
        batchNo: i.batchNo.trim() || undefined,
      })),
    };

    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));

    startTransition(async () => {
      try {
        const res = await saveStockTransferAction(null, fd);
        if (!res?.ok) {
          setErrorMsg(res?.message || "মাল হস্তান্তর সংরক্ষণ করতে ব্যর্থ হয়েছে।");
        } else {
          setSuccessMsg(`মাল হস্তান্তর চালান সফলভাবে সংরক্ষিত হয়েছে! (চালান নং: ${res.data?.transferNo ?? ""})`);
          // Reset item inputs
          setItems([{ productId: "", quantity: "", batchNo: "" }]);
          setVehicleNo("");
          setDriverName("");
          setNotes("");
          router.refresh();
        }
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : "অপ্রত্যাশিত ত্রুটি ঘটেছে।");
      }
    });
  };

  // Delete transfer
  const handleDelete = (transferId: string, transferNo: string) => {
    if (!confirm(`আপনি কি নিশ্চিত যে চালান "${transferNo}" মুছে ফেলতে চান?\nএতে উভয় গুদামের স্টক পুনরায় পূর্বাবস্থায় ফিরে যাবে।`)) {
      return;
    }
    setDeletingId(transferId);
    setErrorMsg(null);
    setSuccessMsg(null);

    startTransition(async () => {
      try {
        const res = await deleteStockTransferAction(transferId, null, new FormData());
        if (!res?.ok) {
          setErrorMsg(res?.message || "হস্তান্তর বাতিল করতে ব্যর্থ হয়েছে।");
        } else {
          setSuccessMsg(`চালান "${transferNo}" সফলভাবে বাতিল ও স্টক রিভার্স করা হয়েছে।`);
          router.refresh();
        }
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : "অপ্রত্যাশিত ত্রুটি ঘটেছে।");
      } finally {
        setDeletingId(null);
      }
    });
  };

  // Filter transfers history
  const filteredTransfers = initialTransfers.filter((t) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      t.transferNo.toLowerCase().includes(q) ||
      t.fromWarehouse.name.toLowerCase().includes(q) ||
      t.toWarehouse.name.toLowerCase().includes(q) ||
      (t.vehicleNo && t.vehicleNo.toLowerCase().includes(q)) ||
      (t.driverName && t.driverName.toLowerCase().includes(q)) ||
      t.items.some((i) => i.productName.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6">
      {/* Alert Messages */}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800 shadow-sm animate-in fade-in">
          ⚠️ {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800 shadow-sm animate-in fade-in">
          ✓ {successMsg}
        </div>
      )}

      {/* Entry Form */}
      {canManage && (
        <section className="panel border border-brand-200 shadow-sm">
          <div className="panel-head flex items-center justify-between border-b border-rule bg-brand-50/50 px-5 py-3">
            <div>
              <h2 className="panel-title text-base font-bold text-ink-900">⇄ নতুন গুদাম মাল হস্তান্তর চালান</h2>
              <p className="text-xs text-slate-500">এক গুদাম থেকে অন্য গুদামে পণ্য স্থানান্তর করুন</p>
            </div>
            <span className="inline-flex items-center rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-800">
              চালান কোড: TRF-স্বয়ংক্রিয়
            </span>
          </div>

          <form onSubmit={handleSubmit} className="p-5 space-y-5">
            {/* Row 1: Date & Warehouses */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  হস্তান্তরের তারিখ <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input w-full"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  প্রেরক গুদাম (From) <span className="text-red-500">*</span>
                </label>
                <select
                  value={fromWarehouseId}
                  onChange={(e) => {
                    setFromWarehouseId(e.target.value);
                    if (e.target.value === toWarehouseId) {
                      const other = warehouses.find((w) => w.id !== e.target.value)?.id ?? "";
                      setToWarehouseId(other);
                    }
                  }}
                  className="select w-full font-medium text-slate-900"
                  required
                >
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} {w.isDefault ? "(প্রধান)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  প্রাপক গুদাম (To) <span className="text-red-500">*</span>
                </label>
                <select
                  value={toWarehouseId}
                  onChange={(e) => setToWarehouseId(e.target.value)}
                  className="select w-full font-medium text-slate-900"
                  required
                >
                  <option value="">-- প্রাপক গুদাম বেছে নিন --</option>
                  {warehouses
                    .filter((w) => w.id !== fromWarehouseId)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Row 2: Transport & Driver Details */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">গাড়ি / ট্রাক নম্বর (ঐচ্ছিক)</label>
                <input
                  type="text"
                  placeholder="যেমন: ঢাকা মেট্রো-ট-১২৩৪৫৬"
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value)}
                  className="input w-full text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">চালকের নাম (ঐচ্ছিক)</label>
                <input
                  type="text"
                  placeholder="যেমন: মো: রফিক মিয়া"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  className="input w-full text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">মন্তব্য / বিবরণ (ঐচ্ছিক)</label>
                <input
                  type="text"
                  placeholder="যেমন: মিলিং এর উদ্দেশ্যে প্রেরণ"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input w-full text-xs"
                />
              </div>
            </div>

            {/* Row 3: Product Items Dynamic Table */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  হস্তান্তরের পণ্যসমূহ ও পরিমাণ
                </h3>
                <span className="text-xs text-slate-500">
                  প্রেরক গুদাম পরিবর্তন করলে লাইভ স্টক স্বয়ংক্রিয়ভাবে আপডেট হবে
                </span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-rule">
                <table className="table min-w-full">
                  <thead>
                    <tr className="bg-slate-100 text-xs font-semibold text-slate-700">
                      <th className="w-12 text-center">#</th>
                      <th className="min-w-[220px]">পণ্য নির্বাচন</th>
                      <th className="w-36 text-right">প্রেরক গুদামে মজুদ</th>
                      <th className="w-36 text-right">হস্তান্তরের পরিমাণ</th>
                      <th className="w-32">ব্যাচ নং (ঐচ্ছিক)</th>
                      <th className="w-12 text-center">মুছুন</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule text-sm">
                    {items.map((row, idx) => {
                      const selectedPr = products.find((p) => p.id === row.productId);
                      const currentStock = getAvailableStock(fromWarehouseId, row.productId);
                      const reqQty = Number(row.quantity) || 0;
                      const isOverStock = reqQty > currentStock && Boolean(row.productId);

                      return (
                        <tr key={idx} className={isOverStock ? "bg-red-50/60" : "hover:bg-slate-50/50"}>
                          <td className="text-center font-medium text-slate-500">{toBn(idx + 1)}</td>
                          <td>
                            <select
                              value={row.productId}
                              onChange={(e) => handleItemChange(idx, "productId", e.target.value)}
                              className="select w-full text-xs font-medium"
                              required
                            >
                              <option value="">-- পণ্য বেছে নিন --</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} {p.code ? `(${p.code})` : ""} - {p.unit.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="text-right">
                            {row.productId ? (
                              <span
                                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${
                                  currentStock > 0 ? "bg-slate-100 text-slate-800" : "bg-red-100 text-red-700"
                                }`}
                              >
                                {formatQty(currentStock)} {selectedPr?.unit.name}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                          <td>
                            <div className="relative">
                              <input
                                type="number"
                                step="any"
                                min="0.001"
                                placeholder="0.00"
                                value={row.quantity}
                                onChange={(e) => handleItemChange(idx, "quantity", e.target.value)}
                                className={`input w-full text-right font-semibold tabular-nums text-xs ${
                                  isOverStock ? "border-red-400 bg-red-50 text-red-700" : ""
                                }`}
                                required
                              />
                              {isOverStock && (
                                <span className="absolute -bottom-4 right-0 text-[10px] text-red-600 font-bold whitespace-nowrap">
                                  মজুদ ছাড়িয়েছে!
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <input
                              type="text"
                              placeholder="ব্যাচ নং"
                              value={row.batchNo}
                              onChange={(e) => handleItemChange(idx, "batchNo", e.target.value)}
                              className="input w-full text-xs"
                            />
                          </td>
                          <td className="text-center">
                            <button
                              type="button"
                              onClick={() => removeItemRow(idx)}
                              className="text-slate-400 hover:text-red-600 p-1"
                              title="বাদ দিন"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={addItemRow}
                  className="btn-secondary text-xs inline-flex items-center gap-1"
                >
                  + আরও পণ্য যোগ করুন
                </button>

                <div className="text-xs font-semibold text-slate-600">
                  মোট নির্বাচিত পণ্য: <span className="font-bold text-ink-900">{toBn(items.filter((i) => i.productId).length)} টি</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-rule">
              <button
                type="submit"
                disabled={isPending}
                className="btn-primary inline-flex items-center gap-2 px-6 py-2.5 text-sm"
              >
                {isPending ? "হস্তান্তর হচ্ছে..." : "✓ মাল হস্তান্তর নিশ্চিত করুন"}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* History Table */}
      <section className="panel">
        <div className="panel-head flex flex-wrap items-center justify-between gap-3 border-b border-rule p-4">
          <div>
            <h2 className="panel-title text-base font-bold text-ink-900">
              📋 সাম্প্রতিক গুদাম মাল হস্তান্তরের তালিকা
            </h2>
            <p className="text-xs text-slate-500">
              সর্বশেষ হস্তান্তরের রেকর্ড, গেট পাস চালান প্রিন্ট ও ব্যবস্থাপনা
            </p>
          </div>

          <div className="w-full sm:w-64">
            <input
              type="text"
              placeholder="চালান নং বা পণ্য দিয়ে খুঁজুন..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="input w-full text-xs"
            />
          </div>
        </div>

        {filteredTransfers.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            কোনো মাল হস্তান্তরের রেকর্ড পাওয়া যায়নি।
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-full">
              <thead>
                <tr className="bg-slate-50 text-xs font-bold text-slate-700">
                  <th>চালান নং</th>
                  <th>তারিখ</th>
                  <th>প্রেরক গুদাম</th>
                  <th>প্রাপক গুদাম</th>
                  <th>পণ্যসমূহ ও পরিমাণ</th>
                  <th>গাড়ি / চালক</th>
                  <th>মন্তব্য</th>
                  <th>তৈরি করেছেন</th>
                  <th className="text-right">একশন</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule text-xs">
                {filteredTransfers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="font-bold text-brand-700 whitespace-nowrap">
                      {t.transferNo}
                    </td>
                    <td className="whitespace-nowrap text-slate-600">
                      {formatDate(t.date)}
                    </td>
                    <td className="font-medium text-slate-800 whitespace-nowrap">
                      {t.fromWarehouse.name}
                    </td>
                    <td className="font-medium text-slate-800 whitespace-nowrap">
                      {t.toWarehouse.name}
                    </td>
                    <td>
                      <div className="space-y-1">
                        {t.items.map((it) => (
                          <div key={it.id} className="inline-block mr-2 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800">
                            {it.productName}: <span className="font-bold">{formatQty(it.quantity)}</span> {it.unitName}
                            {it.batchNo ? ` (ব্যাচ: ${it.batchNo})` : ""}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="text-slate-600 whitespace-nowrap">
                      {[t.vehicleNo, t.driverName].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="text-slate-500 max-w-[150px] truncate" title={t.notes ?? ""}>
                      {t.notes || "—"}
                    </td>
                    <td className="text-slate-600 whitespace-nowrap">
                      {t.createdBy?.name || "—"}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <Link
                          href={`/products/stock-transfer/${t.id}/print`}
                          target="_blank"
                          className="btn-secondary px-2.5 py-1 text-xs inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-800"
                        >
                          🖨 চালান প্রিন্ট
                        </Link>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => handleDelete(t.id, t.transferNo)}
                            disabled={deletingId === t.id || isPending}
                            className="btn-danger px-2 py-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="মুছে ফেলুন এবং স্টক ফিরিয়ে নিন"
                          >
                            {deletingId === t.id ? "মুছছে..." : "বাতিল"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

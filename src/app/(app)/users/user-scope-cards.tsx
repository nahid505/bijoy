"use client";

import { useMemo, useState } from "react";
import { toBnDigits } from "@/lib/format";

export interface GroupItem {
  id: string;
  name: string;
  nature: string;
  parentId: string | null;
  parentName?: string | null;
}

export interface CashAccountItem {
  id: string;
  name: string;
  kind: string;
  code?: string | null;
  bankName?: string | null;
  accountNumber?: string | null;
}

const NATURE_MAP: Record<string, { label: string; color: string }> = {
  ASSET: { label: "সম্পদ", color: "bg-blue-50 text-blue-700 border-blue-200" },
  LIABILITY: { label: "দায়", color: "bg-amber-50 text-amber-700 border-amber-200" },
  EQUITY: { label: "মালিকানাস্বত্ব", color: "bg-purple-50 text-purple-700 border-purple-200" },
  REVENUE: { label: "আয়", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  EXPENSE: { label: "ব্যয়", color: "bg-rose-50 text-rose-700 border-rose-200" },
};

export function AccountGroupChecklist({
  groups,
  initialSelectedIds = [],
}: {
  groups: GroupItem[];
  initialSelectedIds?: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelectedIds));
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.parentName && g.parentName.toLowerCase().includes(q)) ||
        (NATURE_MAP[g.nature]?.label || "").toLowerCase().includes(q)
    );
  }, [groups, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(groups.map((g) => g.id)));
  };

  const deselectAll = () => {
    setSelected(new Set());
  };

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      {/* Hidden inputs to submit selected group IDs with form */}
      {Array.from(selected).map((id) => (
        <input key={id} type="hidden" name="accountGroupIds" value={id} />
      ))}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">অনুমোদিত অ্যাকাউন্ট গ্রুপসমূহ</h4>
          <span className="text-xs text-slate-500">
            নির্বাচিত: <strong className="text-brand-600">{toBnDigits(selected.size)}</strong> টি গ্রুপ
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={selectAll}
            className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            সব নির্বাচন
          </button>
          <span className="text-slate-300">|</span>
          <button
            type="button"
            onClick={deselectAll}
            className="font-medium text-slate-500 hover:text-slate-700 hover:underline"
          >
            বাতিল
          </button>
        </div>
      </div>

      <div className="relative mb-2">
        <svg className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          placeholder="গ্রুপের নাম দিয়ে খুঁজুন..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-slate-200 pl-8 pr-3 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="mb-2 flex items-start gap-1.5 rounded bg-amber-50 p-2 text-[11px] text-amber-800 border border-amber-100">
        <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          কোনো গ্রুপ নির্বাচন করলে তার অধীনস্থ সকল সাব-গ্রুপও স্বয়ংক্রিয়ভাবে অনুমোদিত হবে। খালি রাখলে কোনো গ্রুপভিত্তিক বিধিনিষেধ থাকবে না (সকল গ্রুপ অনুমোদিত)।
        </span>
      </div>

      <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 rounded border border-slate-100">
        {filtered.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-400">কোনো অ্যাকাউন্ট গ্রুপ পাওয়া যায়নি</div>
        ) : (
          filtered.map((g) => {
            const isChecked = selected.has(g.id);
            const natureInfo = NATURE_MAP[g.nature] ?? { label: g.nature, color: "bg-slate-100 text-slate-600 border-slate-200" };
            return (
              <label
                key={g.id}
                className={`flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 transition-colors hover:bg-slate-50 ${
                  isChecked ? "bg-brand-50/40" : ""
                }`}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(g.id)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <div className="truncate">
                    <span className="text-xs font-medium text-slate-700">{g.name}</span>
                    {g.parentName && (
                      <span className="ml-1 text-[10px] text-slate-400">
                        (মূল: {g.parentName})
                      </span>
                    )}
                  </div>
                </div>
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${natureInfo.color}`}>
                  {natureInfo.label}
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

export function PaymentAccountChecklist({
  accounts,
  initialSelectedIds = [],
}: {
  accounts: CashAccountItem[];
  initialSelectedIds?: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelectedIds));
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.code && a.code.toLowerCase().includes(q)) ||
        (a.bankName && a.bankName.toLowerCase().includes(q)) ||
        (a.accountNumber && a.accountNumber.toLowerCase().includes(q))
    );
  }, [accounts, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(accounts.map((a) => a.id)));
  };

  const deselectAll = () => {
    setSelected(new Set());
  };

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      {/* Hidden inputs to submit selected account IDs with form */}
      {Array.from(selected).map((id) => (
        <input key={id} type="hidden" name="paymentAccountIds" value={id} />
      ))}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
        <div>
          <h4 className="text-sm font-semibold text-slate-800">অনুমোদিত ক্যাশ/ব্যাংক পরিশোধ উৎস</h4>
          <span className="text-xs text-slate-500">
            নির্বাচিত: <strong className="text-brand-600">{toBnDigits(selected.size)}</strong> টি উৎস
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <button
            type="button"
            onClick={selectAll}
            className="font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            সব নির্বাচন
          </button>
          <span className="text-slate-300">|</span>
          <button
            type="button"
            onClick={deselectAll}
            className="font-medium text-slate-500 hover:text-slate-700 hover:underline"
          >
            বাতিল
          </button>
        </div>
      </div>

      <div className="relative mb-2">
        <svg className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          placeholder="অ্যাকাউন্টের নাম বা নম্বর দিয়ে খুঁজুন..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-slate-200 pl-8 pr-3 py-1.5 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="mb-2 flex items-start gap-1.5 rounded bg-blue-50 p-2 text-[11px] text-blue-800 border border-blue-100">
        <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          ব্যবহারকারী শুধুমাত্র এখানে নির্বাচিত ক্যাশ/ব্যাংক অ্যাকাউন্টগুলো ব্যবহার করে টাকা পরিশোধ বা খরচ প্রদান করতে পারবেন। খালি রাখলে সব ক্যাশ/ব্যাংক অ্যাকাউন্ট উন্মুক্ত থাকবে।
        </span>
      </div>

      <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 rounded border border-slate-100">
        {filtered.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-400">কোনো ক্যাশ বা ব্যাংক অ্যাকাউন্ট পাওয়া যায়নি</div>
        ) : (
          filtered.map((a) => {
            const isChecked = selected.has(a.id);
            const isBank = a.kind === "BANK";
            return (
              <label
                key={a.id}
                className={`flex cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 transition-colors hover:bg-slate-50 ${
                  isChecked ? "bg-brand-50/40" : ""
                }`}
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(a.id)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <div className="truncate">
                    <span className="text-xs font-medium text-slate-700">{a.name}</span>
                    {(a.bankName || a.accountNumber) && (
                      <span className="ml-1 text-[10px] text-slate-400">
                        ({[a.bankName, a.accountNumber].filter(Boolean).join(" · ")})
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                    isBank
                      ? "bg-cyan-50 text-cyan-700 border-cyan-200"
                      : "bg-emerald-50 text-emerald-700 border-emerald-200"
                  }`}
                >
                  {isBank ? "ব্যাংক" : "নগদ"}
                </span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

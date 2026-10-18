"use client";

// Searchable multi-select of customers / suppliers (user assignment). Searches /api/lookup on demand, shows
// the chosen ones as chips and posts their ids as repeated hidden inputs (name = e.g. "customerIds").
import { useEffect, useId, useRef, useState } from "react";
import { toBnDigits } from "@/lib/format";

export interface PartyChoice {
  /** Customer.id / Supplier.id */
  id: string;
  name: string;
  mobile?: string | null;
}

interface Hit {
  partyId: string;
  name: string;
  mobile: string | null;
}

export function PartyMultiSelect({
  kind,
  name,
  label,
  initial,
  disabled,
}: {
  kind: "customers" | "suppliers";
  /** form field name of the hidden inputs */
  name: string;
  label: string;
  initial: PartyChoice[];
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<PartyChoice[]>(initial);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    setLoading(true);
    const t = window.setTimeout(() => {
      fetch(`/api/lookup/${kind}?q=${encodeURIComponent(query)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items?: Hit[] }) => setHits(d.items ?? []))
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 200);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [kind, query, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const isOn = (id: string) => selected.some((s) => s.id === id);
  const toggle = (h: Hit) =>
    setSelected((cur) => (cur.some((s) => s.id === h.partyId) ? cur.filter((s) => s.id !== h.partyId) : [...cur, { id: h.partyId, name: h.name, mobile: h.mobile }]));

  return (
    <div ref={box} className="relative" data-multi={name}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label mb-0">{label}</span>
        <span className="text-xs text-slate-500">
          {toBnDigits(selected.length)} জন নির্বাচিত
          {selected.length > 0 && !disabled && (
            <button type="button" className="ml-2 text-credit hover:underline" onClick={() => setSelected([])}>সব বাদ</button>
          )}
        </span>
      </div>
      {selected.map((s) => <input key={s.id} type="hidden" name={name} value={s.id} />)}
      <div className="flex min-h-[2.5rem] flex-wrap items-center gap-1 rounded-md border border-rule bg-white px-2 py-1.5">
        {selected.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800 ring-1 ring-brand-200" data-chip>
            {s.name}
            {!disabled && (
              <button type="button" aria-label={`${s.name} বাদ দিন`} className="text-brand-700 hover:text-credit" onClick={() => setSelected((cur) => cur.filter((x) => x.id !== s.id))}>✕</button>
            )}
          </span>
        ))}
        <input
          id={`${name}-search`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={`${label} খুঁজুন`}
          className="min-w-[10rem] flex-1 border-0 bg-transparent p-1 text-sm outline-none"
          placeholder="🔍 নাম বা মোবাইল দিয়ে খুঁজুন…"
          value={query}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") e.preventDefault();
          }}
        />
      </div>
      {open && !disabled && (
        <ul id={listId} role="listbox" aria-multiselectable="true" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-rule bg-white py-1 text-sm shadow-lg">
          {loading && hits.length === 0 && <li className="px-3 py-2 text-slate-500">খোঁজা হচ্ছে…</li>}
          {!loading && hits.length === 0 && <li className="px-3 py-2 text-slate-500">কিছু পাওয়া যায়নি</li>}
          {hits.map((h) => (
            <li
              key={h.partyId}
              role="option"
              aria-selected={isOn(h.partyId)}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-brand-50 ${isOn(h.partyId) ? "bg-brand-50/60" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => toggle(h)}
            >
              <input type="checkbox" readOnly checked={isOn(h.partyId)} tabIndex={-1} aria-hidden />
              <span className="flex-1">{h.name}</span>
              {h.mobile && <span className="text-xs text-slate-500">{h.mobile}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

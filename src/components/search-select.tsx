"use client";

// Reusable searchable picker for customers, suppliers and products.
// Same UX everywhere: type to search (name, code / SKU, mobile, barcode, id) with debounce, keyboard
// navigation (↑ ↓ Home End Enter Esc), loading / empty states and an inline "create new" dialog.
// Results come from /api/lookup/<kind>, scoped to the signed-in business.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDrCr, formatMoney, formatQty } from "@/lib/format";
import { quickCreatePartyAction, quickCreateProductAction } from "@/server/actions/lookup";
import { anchoredStyle, useAnchoredPosition, useDebounced } from "./popover-utils";
import type { PartyOption, ProductOption, UnitOption } from "./trade-parts";

export type LookupKind = "customers" | "suppliers" | "products" | "employees";
/** an employee in the payroll pickers */
export interface EmployeeOption {
  id: string;
  name: string;
  code: string;
  mobile: string | null;
  designation: string | null;
  department: string | null;
  status: string;
}
type Item = PartyOption | ProductOption | EmployeeOption;

const DEBOUNCE_MS = 250;
const NOUN: Record<LookupKind, string> = { customers: "কাস্টমার", suppliers: "সরবরাহকারী", products: "পণ্য", employees: "কর্মচারী" };

/** Secondary line and right-hand figure for an option. */
function describe(kind: LookupKind, item: Item, ctx: { currency: string; unitName?: (id: string) => string; priceOf?: (p: ProductOption) => number }) {
  if (kind === "employees") {
    const e = item as EmployeeOption;
    return {
      sub: [e.code, e.designation, e.department].filter(Boolean).join(" · "),
      right: e.mobile ?? "",
      right2: ["RESIGNED", "TERMINATED"].includes(e.status) ? "অব্যাহতিপ্রাপ্ত" : "",
      warn: ["RESIGNED", "TERMINATED"].includes(e.status),
    };
  }
  if (kind === "products") {
    const p = item as ProductOption;
    return {
      sub: [p.code && `কোড ${p.code}`, p.barcode && `বারকোড ${p.barcode}`].filter(Boolean).join(" · "),
      right: `মজুদ ${formatQty(p.stock)} ${ctx.unitName?.(p.unitId) ?? ""}`,
      right2: formatMoney(ctx.priceOf ? ctx.priceOf(p) : p.salePrice, ctx.currency),
      warn: p.stock <= 0,
    };
  }
  const a = item as PartyOption & { code?: string | null };
  return {
    sub: [a.mobile && `📞 ${a.mobile}`, a.code && `কোড ${a.code}`].filter(Boolean).join(" · "),
    right: a.balance !== undefined ? formatDrCr(a.balance, ctx.currency) : "",
    right2: a.overdue ? `মেয়াদোত্তীর্ণ ${formatMoney(a.overdue, ctx.currency)}` : "",
    warn: !!a.overdue,
  };
}

export interface SearchSelectProps<T extends Item> {
  kind: LookupKind;
  value: T | null;
  onChange: (item: T | null) => void;
  id?: string;
  /** name of a hidden input carrying the selected id (for plain GET / POST forms) */
  name?: string;
  placeholder?: string;
  /** offers an explicit "nothing" choice, e.g. "নগদ কাস্টমার (ওয়াক-ইন)" */
  noneLabel?: string;
  disabled?: boolean;
  /** enable "create new" (units are needed for products) */
  create?: false | { units?: UnitOption[] };
  batchOnly?: boolean;
  currency?: string;
  unitName?: (id: string) => string;
  priceOf?: (p: ProductOption) => number;
  ariaLabel?: string;
  className?: string;
}

export function SearchSelect<T extends Item>({
  kind, value, onChange, id, name, placeholder, noneLabel, disabled = false, create = false, batchOnly = false,
  currency = "৳", unitName, priceOf, ariaLabel, className = "",
}: SearchSelectProps<T>) {
  const uid = useId();
  const inputId = id ?? `ss-${uid}`;
  const listId = `${inputId}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState(false);
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const [resultFor, setResultFor] = useState<string | null>(null); // the query the shown items belong to
  const [pendingEnter, setPendingEnter] = useState(false); // Enter pressed before the results caught up
  const [mayCreate, setMayCreate] = useState(false); // the server says whether this user may add new records
  const debounced = useDebounced(query, DEBOUNCE_MS);

  // entries: [none?] + results + [create?]
  const showNone = !!noneLabel && !typed;
  const showCreate = !!create && mayCreate && !error;
  const entries: ({ type: "none" } | { type: "item"; item: T } | { type: "create" })[] = [
    ...(showNone ? [{ type: "none" as const }] : []),
    ...items.map((item) => ({ type: "item" as const, item })),
    ...(showCreate && !loading ? [{ type: "create" as const }] : []),
  ];

  // search (debounced, cancellable)
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    const q = typed ? debounced : "";
    fetch(`/api/lookup/${kind}?q=${encodeURIComponent(q)}${batchOnly ? "&batchOnly=1" : ""}`, { signal: ctrl.signal, headers: { accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "খোঁজার অনুমতি নেই" : "খোঁজা যায়নি");
        const body = (await r.json()) as { items: T[]; canCreate?: boolean };
        setItems(body.items);
        setResultFor(q);
        setMayCreate(!!body.canCreate);
        setActive(body.items.length && showNone ? 1 : 0);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") {
          setItems([]);
          setError(e.message || "খোঁজা যায়নি — আবার চেষ্টা করুন");
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debounced, typed, kind, batchOnly]);

  const pos = useAnchoredPosition(inputRef, open, kind === "products" ? 340 : 300);

  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  // results still belong to an older query (typing fast, or a barcode scanner sending code + Enter)
  const stale = loading || resultFor !== (typed ? query : "") || (typed && debounced !== query);

  const close = () => {
    setPendingEnter(false);
    setOpen(false);
    setTyped(false);
    setQuery("");
  };
  const choose = (i: number) => {
    const e = entries[i];
    if (!e) return;
    if (e.type === "create") {
      setCreating(typed ? query.trim() : "");
      setOpen(false);
      return;
    }
    onChange(e.type === "none" ? null : e.item);
    close();
  };

  // an early Enter picks the best match once the results for what was typed have arrived
  useEffect(() => {
    if (!pendingEnter || stale) return;
    setPendingEnter(false);
    if (items.length) choose(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnter, stale]);

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (!open && (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter")) {
      ev.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    const last = entries.length - 1;
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActive((a) => (a >= last ? 0 : a + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive((a) => (a <= 0 ? last : a - 1)); }
    else if (ev.key === "Home") { ev.preventDefault(); setActive(0); }
    else if (ev.key === "End") { ev.preventDefault(); setActive(last); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (stale) setPendingEnter(true); else choose(active); }
    else if (ev.key === "Escape") { ev.preventDefault(); close(); }
    else if (ev.key === "Tab") close();
  };

  const shown = open && typed ? query : value?.name ?? "";
  const activeId = open && entries[active] ? `${listId}-${active}` : undefined;
  const noun = NOUN[kind];

  return (
    <div className={`relative ${className}`}>
      {name && <input type="hidden" name={name} value={value?.id ?? ""} />}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-busy={loading}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        className={`input pr-7 ${disabled ? "bg-slate-100" : ""}`}
        placeholder={value ? value.name : placeholder ?? noneLabel ?? `${noun} খুঁজুন — নাম, ${kind === "employees" ? "আইডি" : "কোড"}, মোবাইল${kind === "products" ? ", বারকোড" : ""}`}
        value={shown}
        onFocus={(e) => {
          e.currentTarget.select();
          if (!disabled) setOpen(true);
        }}
        onClick={() => !disabled && setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setTyped(true);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(close, 150)}
      />
      <span aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{loading && open ? "⏳" : "⌄"}</span>

      {open && pos && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${noun} তালিকা`}
          style={anchoredStyle(pos)}
          className="z-50 max-h-72 overflow-y-auto rounded-md border border-rule bg-white py-1 text-sm shadow-xl"
          onMouseDown={(e) => e.preventDefault()}
        >
          {loading && (
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500" aria-live="polite">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> খোঁজা হচ্ছে…
            </li>
          )}
          {!loading && error && <li className="px-3 py-2 text-xs text-red-700" role="alert">{error}</li>}
          {!loading && !error && items.length === 0 && (
            <li className="px-3 py-2 text-xs text-slate-500">কিছু পাওয়া যায়নি{typed ? ` “${query}”` : ""} — নাম, কোড, মোবাইল{kind === "products" ? " বা বারকোড" : ""} দিয়ে খুঁজুন</li>
          )}
          {entries.map((e, i) => {
            const isActive = i === active;
            const base = `cursor-pointer px-3 py-1.5 ${isActive ? "bg-brand-50" : "hover:bg-ink-50"}`;
            if (e.type === "none") {
              return <li key="none" id={`${listId}-${i}`} role="option" aria-selected={!value} className={`${base} text-slate-600`} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>{noneLabel}</li>;
            }
            if (e.type === "create") {
              return (
                <li key="create" id={`${listId}-${i}`} role="option" aria-selected={false} className={`${base} border-t border-rule font-semibold text-brand-700`} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
                  + নতুন {noun} তৈরি করুন{typed && query.trim() ? `: “${query.trim()}”` : ""}
                </li>
              );
            }
            const d = describe(kind, e.item, { currency, unitName, priceOf });
            return (
              <li key={e.item.id} id={`${listId}-${i}`} role="option" aria-selected={value?.id === e.item.id} className={`${base} flex items-start justify-between gap-3`} onMouseEnter={() => setActive(i)} onClick={() => choose(i)}>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-900">{e.item.name}</span>
                  {d.sub && <span className="block truncate text-[11px] text-slate-500">{d.sub}</span>}
                </span>
                <span className="shrink-0 text-right text-[11px]">
                  <span className={`block ${d.warn ? "text-credit" : "text-slate-600"}`}>{d.right}</span>
                  {d.right2 && <span className={`block ${kind === "products" ? "font-semibold text-ink-800" : "text-credit"}`}>{d.right2}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {creating !== null && createPortal(
        // rendered in <body>: the dialog has its own <form> and must not sit inside the voucher form
        <QuickCreateDialog
          kind={kind}
          initialName={creating}
          units={create ? create.units ?? [] : []}
          onCancel={() => {
            setCreating(null);
            inputRef.current?.focus();
          }}
          onCreated={(item) => {
            setCreating(null);
            onChange(item as T);
            inputRef.current?.focus();
          }}
        />,
        document.body,
      )}
    </div>
  );
}

function QuickCreateDialog({ kind, initialName, units, onCancel, onCreated }: { kind: LookupKind; initialName: string; units: UnitOption[]; onCancel: () => void; onCreated: (item: Item) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const base = units.filter((u) => !u.baseUnitId);
  const submit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    ev.stopPropagation(); // never submit the voucher form around this dialog
    const fd = new FormData(ev.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "");
    setBusy(true);
    setMessage(null);
    try {
      const r =
        kind === "products"
          ? await quickCreateProductAction({ name: get("qcName"), code: get("qcCode"), barcode: get("qcBarcode"), unitId: get("qcUnit"), purchasePrice: get("qcPurchase"), salePrice: get("qcSale") })
          : await quickCreatePartyAction(kind === "customers" ? "CUSTOMER" : "SUPPLIER", { name: get("qcName"), mobile: get("qcMobile") });
      if (r.ok) onCreated(r.item);
      else {
        setMessage(r.message);
        setErrors(r.errors ?? {});
      }
    } finally {
      setBusy(false);
    }
  };
  const err = (k: string) => errors[k]?.[0];
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-rule p-0 shadow-2xl backdrop:bg-ink-950/50"
    >
      <form onSubmit={submit} className="space-y-3 p-5" noValidate>
        <h2 className="text-base font-bold text-ink-900">নতুন {NOUN[kind]} তৈরি করুন</h2>
        {message && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
        <div>
          <label className="label" htmlFor="qcName">নাম *</label>
          <input id="qcName" name="qcName" defaultValue={initialName} required autoFocus className="input" />
          {err("name") && <p className="mt-1 text-xs text-red-600">{err("name")}</p>}
        </div>
        {kind !== "products" ? (
          <div>
            <label className="label" htmlFor="qcMobile">মোবাইল</label>
            <input id="qcMobile" name="qcMobile" type="tel" className="input" placeholder="01XXXXXXXXX" />
            {err("mobile") && <p className="mt-1 text-xs text-red-600">{err("mobile")}</p>}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="qcCode">কোড / SKU</label><input id="qcCode" name="qcCode" className="input" /></div>
              <div><label className="label" htmlFor="qcBarcode">বারকোড</label><input id="qcBarcode" name="qcBarcode" className="input" /></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="qcUnit">ইউনিট *</label>
                <select id="qcUnit" name="qcUnit" className="input" defaultValue={base[0]?.id}>
                  {base.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div><label className="label" htmlFor="qcPurchase">ক্রয়মূল্য</label><input id="qcPurchase" name="qcPurchase" type="number" min="0" step="0.01" className="input-num" /></div>
              <div><label className="label" htmlFor="qcSale">বিক্রয়মূল্য</label><input id="qcSale" name="qcSale" type="number" min="0" step="0.01" className="input-num" /></div>
            </div>
            {(err("code") || err("barcode") || err("unitId")) && <p className="text-xs text-red-600">{err("code") ?? err("barcode") ?? err("unitId")}</p>}
          </>
        )}
        <div className="flex justify-end gap-2 border-t border-rule pt-3">
          <button type="button" className="btn-secondary" onClick={onCancel}>বাতিল</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "তৈরি হচ্ছে…" : "তৈরি করে বেছে নিন"}</button>
        </div>
      </form>
    </dialog>
  );
}

/** Uncontrolled picker for plain GET filter forms (server pages): posts the picked id under `name`. */
export function SearchSelectField<T extends Item>({ initial, ...props }: Omit<SearchSelectProps<T>, "value" | "onChange"> & { initial: T | null; name: string }) {
  const [value, setValue] = useState<T | null>(initial);
  return <SearchSelect<T> {...props} value={value} onChange={setValue} />;
}

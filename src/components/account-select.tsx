"use client";

// SearchableAccountSelect — the one ledger-account picker used everywhere an account is chosen
// (receipt / payment / expense / journal lines, the cash-bank field, payment rows of sales & purchase
// and POS, report filters). A button opens a dropdown with "🔍 হিসাব খুঁজুন..." at the top; results come
// from /api/lookup/accounts (server-side search, paged), so thousands of ledgers stay fast.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatDrCr } from "@/lib/format";
import { accountGroupsForCreateAction, quickCreateAccountAction } from "@/server/actions/lookup";
import { anchoredStyle, useAnchoredPosition, useDebounced } from "./popover-utils";
import type { AccountOption } from "./trade-parts";

export type AccountScope = "all" | "cash" | "cash-in-hand" | "bank" | "expense";
/** what the picker knows about an account (search results carry the optional extras) */
export type AccountItem = AccountOption & { code?: string | null; kind?: string; detail?: string | null };

const DEBOUNCE_MS = 200;

type Entry = { type: "none" } | { type: "item"; item: AccountItem } | { type: "more" } | { type: "create" };

export interface SearchableAccountSelectProps {
  /** selected account id ("" = none) */
  value: string;
  onChange: (id: string, account: AccountItem | null) => void;
  /** which accounts are offered: all ledgers, cash/bank/mobile banking, or operating expenses */
  scope?: AccountScope;
  /** accounts already known to the page (at least the selected one) — used for the label without a request */
  known?: AccountOption[];
  id?: string;
  /** posts the selected id in a plain <form> */
  name?: string;
  placeholder?: string;
  /** offers an explicit "nothing selected" entry with this label */
  noneLabel?: string;
  disabled?: boolean;
  /** show the "+ নতুন হিসাব তৈরি করুন" entry (still only for users with accounts:manage) */
  allowCreate?: boolean;
  currency?: string;
  ariaLabel?: string;
  className?: string;
}

export function SearchableAccountSelect({
  value, onChange, scope = "all", known, id, name, placeholder = "— হিসাব নির্বাচন —", noneLabel, disabled = false,
  allowCreate = true, currency = "৳", ariaLabel, className = "",
}: SearchableAccountSelectProps) {
  const uid = useId();
  const triggerId = id ?? `acc-${uid}`;
  const listId = `${triggerId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<AccountItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [pendingEnter, setPendingEnter] = useState(false);
  const [mayCreate, setMayCreate] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [labels, setLabels] = useState(() => new Map((known ?? []).map((a) => [a.id, a as AccountItem])));
  const [missing, setMissing] = useState<string | null>(null); // a selected id the server does not know
  const debounced = useDebounced(query, DEBOUNCE_MS);
  const pos = useAnchoredPosition(triggerRef, open, 300, 360);

  const remember = (list: AccountItem[]) =>
    setLabels((m) => {
      const next = new Map(m);
      for (const a of list) next.set(a.id, a);
      return next;
    });

  // new "known" accounts from the page (e.g. after a server re-render)
  useEffect(() => {
    if (known?.length) remember(known);
  }, [known]);

  // label for a selected id the page did not send (fetched once)
  const selected = value ? labels.get(value) : undefined;
  useEffect(() => {
    if (!value || labels.has(value) || missing === value) return;
    const ctrl = new AbortController();
    fetch(`/api/lookup/accounts?ids=${encodeURIComponent(value)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((b: { items: AccountItem[] }) => (b.items.length ? remember(b.items) : setMissing(value)))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [value, labels, missing]);

  // entries: [none?] + results + [load more?] + [create?]
  const entries: Entry[] = [
    ...(noneLabel && !query ? [{ type: "none" as const }] : []),
    ...items.map((item) => ({ type: "item" as const, item })),
    ...(hasMore && !loading ? [{ type: "more" as const }] : []),
    ...(allowCreate && mayCreate && !loading && !error ? [{ type: "create" as const }] : []),
  ];
  const stale = loading || resultFor !== debounced || debounced !== query;

  // search (debounced, cancellable); offset > 0 appends the next page
  const load = (q: string, offset: number, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    return fetch(`/api/lookup/accounts?scope=${scope}&q=${encodeURIComponent(q)}&offset=${offset}`, { signal, headers: { accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? "হিসাব খোঁজার অনুমতি নেই" : "খোঁজা যায়নি — আবার চেষ্টা করুন");
        const body = (await r.json()) as { items: AccountItem[]; hasMore: boolean; canCreate?: boolean };
        setItems((prev) => (offset ? [...prev, ...body.items] : body.items));
        setHasMore(body.hasMore);
        setMayCreate(!!body.canCreate);
        setResultFor(q);
        remember(body.items);
        if (!offset) {
          const sel = body.items.findIndex((a) => a.id === value);
          setActive(sel >= 0 ? sel + (noneLabel && !q ? 1 : 0) : noneLabel && !q && body.items.length ? 1 : 0);
        }
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") {
          if (!offset) setItems([]);
          setError(e.message || "খোঁজা যায়নি — আবার চেষ্টা করুন");
        }
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  };
  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    load(debounced, 0, ctrl.signal);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debounced, scope]);

  // focus the search box as soon as the dropdown is on screen (it renders once its position is known)
  const shown = open && pos !== null;
  useEffect(() => {
    if (shown) searchRef.current?.focus();
  }, [shown]);
  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !popRef.current?.contains(t)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId, open]);

  const openWith = (initial = "") => {
    if (disabled) return;
    setQuery(initial);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    setPendingEnter(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (i: number) => {
    const e = entries[i];
    if (!e) return;
    if (e.type === "more") {
      load(resultFor ?? "", items.length);
      return;
    }
    if (e.type === "create") {
      setCreating(query.trim());
      setOpen(false);
      return;
    }
    onChange(e.type === "none" ? "" : e.item.id, e.type === "none" ? null : e.item);
    close();
  };

  // an early Enter (typed fast, or pasted a code) picks the best match once its results arrive
  useEffect(() => {
    if (!pendingEnter || stale) return;
    setPendingEnter(false);
    if (items.length) choose(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnter, stale]);

  const onTriggerKey = (ev: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(ev.key)) {
      ev.preventDefault();
      openWith();
    } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault(); // start typing on the closed field: open with that letter
      openWith(ev.key);
    } else if ((ev.key === "Delete" || ev.key === "Backspace") && value && noneLabel) {
      ev.preventDefault();
      onChange("", null);
    }
  };
  const onSearchKey = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    const last = entries.length - 1;
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActive((a) => (a >= last ? 0 : a + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive((a) => (a <= 0 ? last : a - 1)); }
    else if (ev.key === "PageDown") { ev.preventDefault(); setActive((a) => Math.min(last, a + 8)); }
    else if (ev.key === "PageUp") { ev.preventDefault(); setActive((a) => Math.max(0, a - 8)); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (stale) setPendingEnter(true); else choose(active); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); }
    else if (ev.key === "Tab") close(false);
  };

  const activeId = open && entries[active] ? `${listId}-${active}` : undefined;
  let lastGroup = "";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? close() : openWith())}
        onKeyDown={onTriggerKey}
        className={`input flex min-h-[2.25rem] items-center justify-between gap-2 pr-2 text-left ${disabled ? "bg-slate-100" : ""}`}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <>
              {selected.name}
              <span className="ml-1.5 text-xs text-slate-400">{selected.group}</span>
            </>
          ) : value && missing !== value ? (
            <span className="text-slate-400">লোড হচ্ছে…</span>
          ) : (
            <span className="text-slate-400">{noneLabel ?? placeholder}</span>
          )}
        </span>
        <span aria-hidden className="shrink-0 text-xs text-slate-400">⌄</span>
      </button>

      {open && pos && (
        <div
          ref={popRef}
          style={anchoredStyle(pos)}
          className={`z-50 flex max-h-[min(24rem,70vh)] flex-col overflow-hidden rounded-md border border-rule bg-white text-sm shadow-xl ${pos.up ? "flex-col-reverse" : ""}`}
        >
          <div className="border-b border-rule p-2">
            <input
              ref={searchRef}
              type="search"
              role="searchbox"
              aria-label="হিসাব খুঁজুন"
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-busy={loading}
              autoComplete="off"
              spellCheck={false}
              placeholder="🔍 হিসাব খুঁজুন..."
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
            />
          </div>
          <ul id={listId} role="listbox" aria-label="হিসাবের তালিকা" className="min-h-0 flex-1 overflow-y-auto py-1" onMouseDown={(e) => e.preventDefault()}>
            {loading && items.length === 0 && (
              <li className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500" aria-live="polite">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" /> খোঁজা হচ্ছে…
              </li>
            )}
            {error && <li className="px-3 py-2 text-xs text-red-700" role="alert">{error}</li>}
            {!loading && !error && items.length === 0 && (
              <li className="px-3 py-3 text-center text-sm text-slate-500" aria-live="polite">কোনো হিসাব পাওয়া যায়নি</li>
            )}
            {entries.map((e, i) => {
              const isActive = i === active;
              const base = `cursor-pointer px-3 py-1.5 ${isActive ? "bg-brand-50" : "hover:bg-ink-50"}`;
              const common = { id: `${listId}-${i}`, onMouseEnter: () => setActive(i), onClick: () => choose(i) };
              if (e.type === "none") return <li key="none" {...common} role="option" aria-selected={!value} className={`${base} text-slate-600`}>{noneLabel}</li>;
              if (e.type === "more") return <li key="more" {...common} role="option" aria-selected={false} className={`${base} text-center text-xs font-medium text-brand-700`}>আরও হিসাব দেখুন ↓</li>;
              if (e.type === "create") {
                return (
                  <li key="create" {...common} role="option" aria-selected={false} className={`${base} border-t border-rule font-medium text-brand-700`}>
                    + নতুন হিসাব তৈরি করুন{query.trim() ? ` — “${query.trim()}”` : ""}
                  </li>
                );
              }
              const a = e.item;
              // group headings while browsing; while searching the group is shown on each row
              const heading = !query && a.group !== lastGroup ? a.group : null;
              lastGroup = a.group;
              const sub = [query ? a.group : null, a.code && `কোড ${a.code}`, a.detail].filter(Boolean).join(" · ");
              return [
                heading && <li key={`h-${i}`} role="presentation" className="bg-ink-50 px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{heading}</li>,
                <li key={a.id} {...common} role="option" aria-selected={a.id === value} className={`${base} flex items-start justify-between gap-3`}>
                  <span className="min-w-0">
                    <span className={`block truncate ${a.id === value ? "font-semibold" : ""}`}>{a.name}</span>
                    {sub && <span className="block truncate text-xs text-slate-500">{sub}</span>}
                  </span>
                  {a.balance !== undefined && <span className="shrink-0 pt-0.5 text-xs tabular-nums text-slate-500">{formatDrCr(a.balance, currency)}</span>}
                </li>,
              ];
            })}
            {loading && items.length > 0 && <li className="px-3 py-1.5 text-center text-xs text-slate-400" aria-live="polite">খোঁজা হচ্ছে…</li>}
          </ul>
        </div>
      )}

      {creating !== null &&
        createPortal(
          // in <body>: the dialog has its own <form> and must not sit inside the voucher form
          <QuickCreateAccountDialog
            scope={scope}
            initialName={creating}
            onCancel={() => {
              setCreating(null);
              triggerRef.current?.focus();
            }}
            onCreated={(a) => {
              setCreating(null);
              remember([a]);
              onChange(a.id, a);
              triggerRef.current?.focus();
            }}
          />,
          document.body,
        )}
    </div>
  );
}

function QuickCreateAccountDialog({ scope, initialName, onCancel, onCreated }: { scope: AccountScope; initialName: string; onCancel: () => void; onCreated: (a: AccountItem) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<{ id: string; name: string; systemKey: string | null }[] | null>(null);
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  useEffect(() => {
    ref.current?.showModal();
    accountGroupsForCreateAction(scope).then((r) => {
      if (r.ok) {
        setGroups(r.groups);
        setGroupId(r.groups[0]?.id ?? "");
      } else {
        setGroups([]);
        setMessage(r.message);
      }
    });
  }, [scope]);
  const bank = groups?.find((g) => g.id === groupId)?.systemKey === "BANK_ACCOUNTS";
  const submit = async (ev: React.FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    ev.stopPropagation(); // never submit the voucher form around this dialog
    const fd = new FormData(ev.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "");
    setBusy(true);
    setMessage(null);
    try {
      const r = await quickCreateAccountAction(scope, { name: get("qaName"), code: get("qaCode"), groupId, bankName: get("qaBank"), accountNumber: get("qaNumber") });
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
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-rule p-0 shadow-2xl backdrop:bg-ink-950/50"
    >
      <form onSubmit={submit} className="space-y-3 p-5" noValidate>
        <h2 className="text-base font-bold text-ink-900">নতুন হিসাব তৈরি করুন</h2>
        {message && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>}
        <div>
          <label className="label" htmlFor="qaName">হিসাবের নাম *</label>
          <input id="qaName" name="qaName" defaultValue={initialName} required autoFocus className="input" />
          {err("name") && <p className="mt-1 text-xs text-red-600">{err("name")}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="qaGroup">গ্রুপ *</label>
            <select id="qaGroup" className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={!groups?.length}>
              {groups === null && <option value="">লোড হচ্ছে…</option>}
              {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {err("groupId") && <p className="mt-1 text-xs text-red-600">{err("groupId")}</p>}
          </div>
          <div>
            <label className="label" htmlFor="qaCode">কোড</label>
            <input id="qaCode" name="qaCode" className="input" placeholder="ঐচ্ছিক, অনন্য" />
            {err("code") && <p className="mt-1 text-xs text-red-600">{err("code")}</p>}
          </div>
        </div>
        {bank && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="qaBank">ব্যাংক / প্রতিষ্ঠান</label><input id="qaBank" name="qaBank" className="input" placeholder="যেমন বিকাশ, ডাচ-বাংলা" /></div>
            <div><label className="label" htmlFor="qaNumber">হিসাব নম্বর</label><input id="qaNumber" name="qaNumber" className="input" /></div>
          </div>
        )}
        <p className="text-xs text-slate-500">প্রারম্ভিক ব্যালেন্স ০ থাকবে — প্রয়োজনে পরে লেজার পাতা থেকে দিন।</p>
        <div className="flex justify-end gap-2 border-t border-rule pt-3">
          <button type="button" className="btn-secondary" onClick={onCancel}>বাতিল</button>
          <button type="submit" className="btn-primary" disabled={busy || !groupId}>{busy ? "তৈরি হচ্ছে…" : "তৈরি করে বেছে নিন"}</button>
        </div>
      </form>
    </dialog>
  );
}

/** Uncontrolled variant for plain GET filter forms (server pages): posts the picked id under `name`. */
export function SearchableAccountField({ initial, ...props }: Omit<SearchableAccountSelectProps, "value" | "onChange" | "known"> & { initial: AccountOption | null; name: string }) {
  const [value, setValue] = useState(initial?.id ?? "");
  return <SearchableAccountSelect {...props} known={initial ? [initial] : []} value={value} onChange={(id) => setValue(id)} />;
}

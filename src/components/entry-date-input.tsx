"use client";

// Date field of an entry form. Locked (no "transaction:change_date" permission): read-only, pinned to
// the given date — today for a new entry, the entry's own date when editing. The server checks again.
export function EntryDateInput({ id, value, onChange, locked, className = "input" }: { id: string; value: string; onChange: (v: string) => void; locked?: boolean; className?: string }) {
  if (!locked) return <input id={id} type="date" className={className} value={value} onChange={(e) => onChange(e.target.value)} />;
  return (
    <>
      <input
        id={id}
        type="date"
        className={`${className} cursor-not-allowed bg-ink-50 text-slate-600`}
        value={value}
        min={value}
        max={value}
        readOnly
        aria-readonly="true"
        aria-describedby={`${id}-lock`}
        data-locked="true"
        onChange={() => {}}
      />
      <p id={`${id}-lock`} className="mt-1 text-xs text-slate-500">🔒 তারিখ লক — তারিখ পরিবর্তনের অনুমতি নেই</p>
    </>
  );
}

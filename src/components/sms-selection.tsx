"use client";

import { useEffect, useState } from "react";

const bn = (n: number) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

/** "SMS to selected customers": reads the ticked rows (name="sms-customer") and opens the composer. */
export function SmsSelectionBar() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(document.querySelectorAll<HTMLInputElement>("input[name=sms-customer]:checked").length);
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
  }, []);
  const open = () => {
    const ids = [...document.querySelectorAll<HTMLInputElement>("input[name=sms-customer]:checked")].map((i) => i.value);
    if (ids.length) window.location.assign(`/sms/compose?customers=${ids.join(",")}`);
  };
  const toggleAll = (on: boolean) => {
    document.querySelectorAll<HTMLInputElement>("input[name=sms-customer]").forEach((i) => (i.checked = on));
    setCount(on ? document.querySelectorAll("input[name=sms-customer]").length : 0);
  };
  return (
    <div className="no-print flex flex-wrap items-center gap-2 border-b border-rule bg-ink-50 px-3 py-2 text-xs">
      <label className="flex items-center gap-1"><input type="checkbox" onChange={(e) => toggleAll(e.target.checked)} aria-label="এই পৃষ্ঠার সবাইকে নির্বাচন" /> সবাই</label>
      <span className="text-slate-500">{count ? `${bn(count)} জন নির্বাচিত` : "এসএমএস পাঠাতে কাস্টমার নির্বাচন করুন"}</span>
      <button type="button" className="btn-primary btn-sm" disabled={count === 0} onClick={open}>✉ নির্বাচিতদের এসএমএস</button>
    </div>
  );
}

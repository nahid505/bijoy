"use client";

import { smsSegments } from "@/lib/sms-text";

const bn = (n: number) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

/** Live length / parts / encoding of an SMS text (Bangla → Unicode, 70 / 67 per part). */
export function SmsCounter({ text }: { text: string }) {
  const s = smsSegments(text);
  return (
    <p className={`text-[11px] ${s.parts > 3 ? "text-amber-700" : "text-slate-500"}`} aria-live="polite">
      {s.encoding === "UCS2" ? "ইউনিকোড (বাংলা)" : "GSM (ইংরেজি)"} · {bn(s.units)} অক্ষর · {bn(s.parts)} টি এসএমএস · শেষ পার্টে আরও {bn(s.remaining)} অক্ষর
    </p>
  );
}

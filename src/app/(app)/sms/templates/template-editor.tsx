"use client";

import { useRef, useState } from "react";
import { renderTemplate, type SmsVars } from "@/lib/sms-text";
import { ActionButton, ActionForm, FieldError, SubmitButton, type FormAction } from "@/components/forms";
import { SmsCounter } from "../sms-counter";

const SAMPLE: SmsVars = {
  customer_name: "রহিম উদ্দিন", supplier_name: "মেঘনা ডিস্ট্রিবিউশন", invoice_no: "INV-000125", total: "১,২৫০", paid: "১,০০০", due: "২৫০",
  date: "৪ অক্টোবর ২০২৬", business_name: "আপনার দোকান", product_name: "নাপা ৫০০ মি.গ্রা.", expiry_date: "৩০ অক্টোবর ২০২৬",
  batch_no: "NP-2410", quantity: "৪৮০ পিস", days: "২৬", otp: "৪৮২৯১৬",
};

export function TemplateEditor({ body, variables, save, reset, customised }: { body: string; variables: string[]; save: FormAction; reset: FormAction; customised: boolean }) {
  const [text, setText] = useState(body);
  const ref = useRef<HTMLTextAreaElement>(null);
  const insert = (v: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, at)}{${v}}${text.slice(el?.selectionEnd ?? at)}`;
    setText(next);
    requestAnimationFrame(() => el?.focus());
  };
  return (
    <ActionForm action={save} className="space-y-2">
      <textarea ref={ref} name="body" rows={3} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} className="input" aria-label="টেমপ্লেট" />
      <FieldError name="body" />
      <div className="flex flex-wrap gap-1">
        {variables.map((v) => (
          <button key={v} type="button" onClick={() => insert(v)} className="rounded border border-rule bg-ink-50 px-1.5 py-0.5 font-mono text-[11px] text-ink-700 hover:bg-brand-50">{`{${v}}`}</button>
        ))}
      </div>
      <SmsCounter text={renderTemplate(text, SAMPLE)} />
      <p className="rounded bg-ink-50 px-2 py-1.5 text-xs text-slate-700"><span className="font-semibold">নমুনা: </span>{renderTemplate(text, SAMPLE)}</p>
      <div className="flex items-center gap-2">
        <SubmitButton className="btn-primary btn-sm">সংরক্ষণ</SubmitButton>
        {customised && <ActionButton action={reset} label="ডিফল্টে ফেরত" className="btn-ghost btn-sm" confirmText="এই টেমপ্লেট ডিফল্ট লেখায় ফিরে যাবে। নিশ্চিত?" />}
      </div>
    </ActionForm>
  );
}

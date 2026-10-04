"use client";

import { useRef, useState } from "react";
import { renderTemplate, smsSegments } from "@/lib/sms-text";
import { ActionForm, ConfirmSubmitButton, FieldError, type FormAction } from "@/components/forms";
import { SmsCounter } from "../sms-counter";

const bn = (n: number) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

export function ComposeForm({
  action,
  hidden,
  count,
  withMobile,
  sample,
}: {
  action: FormAction;
  hidden: Record<string, string>;
  count: number;
  withMobile: number;
  sample: { customer_name: string; due: string; business_name: string };
}) {
  const [text, setText] = useState("প্রিয় {customer_name}, ");
  const ref = useRef<HTMLTextAreaElement>(null);
  const preview = renderTemplate(text, sample);
  const parts = smsSegments(preview).parts;
  const insert = (v: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? text.length;
    setText(`${text.slice(0, at)}{${v}}${text.slice(el?.selectionEnd ?? at)}`);
    requestAnimationFrame(() => el?.focus());
  };
  return (
    <ActionForm action={action} className="space-y-3">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input type="hidden" name="confirmCount" value={count} />
      <label className="label" htmlFor="message">বার্তা</label>
      <textarea id="message" ref={ref} name="message" rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} className="input" />
      <FieldError name="message" />
      <div className="flex flex-wrap gap-1">
        {["customer_name", "due", "business_name"].map((v) => (
          <button key={v} type="button" onClick={() => insert(v)} className="rounded border border-rule bg-ink-50 px-1.5 py-0.5 font-mono text-[11px] hover:bg-brand-50">{`{${v}}`}</button>
        ))}
      </div>
      <SmsCounter text={preview} />
      <p className="rounded bg-ink-50 px-2 py-1.5 text-xs"><span className="font-semibold">নমুনা: </span>{preview}</p>
      <ConfirmSubmitButton
        label={`${bn(withMobile)} জনকে পাঠান`}
        title="এসএমএস পাঠানো নিশ্চিত করুন"
        message={`${bn(count)} জন প্রাপকের মধ্যে ${bn(withMobile)} জনের মোবাইল আছে। প্রায় ${bn(withMobile * parts)} টি এসএমএস (প্রতিটি ${bn(parts)} পার্ট) পাঠানো হবে। একই বার্তা আজ একই নম্বরে আগে গিয়ে থাকলে আবার যাবে না। চালিয়ে যাবেন?`}
        className="btn-primary"
      />
    </ActionForm>
  );
}

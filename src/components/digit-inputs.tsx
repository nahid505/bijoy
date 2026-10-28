"use client";

// Mixed Bangla / English digits in number fields. Number fields are <input type="text" inputMode="decimal" data-numeric>
// (a type="number" input silently drops Bangla digits: "১২451৩৩" became "451"), and this listener rewrites what the
// user types or pastes before React sees it:
//   data-numeric  "১২451৩৩" → "1245133"; letters, commas and spaces are dropped (digits, one ".", a leading "-" stay)
//   type="tel"    Bangla digits → English (+, spaces, "-" and brackets stay)
// It runs in the capture phase on document, so the corrected value is what onChange / the form submits.
import { useEffect } from "react";
import { sanitizeNumber, toAsciiDigits } from "@/lib/digits";

const clean = (el: HTMLInputElement, v: string) => (el.type === "tel" ? toAsciiDigits(v).replace(/[^0-9+\-\s()]/g, "") : sanitizeNumber(v));
const nativeValue = typeof window === "undefined" ? undefined : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
const applies = (t: EventTarget | null): t is HTMLInputElement => t instanceof HTMLInputElement && (t.dataset.numeric !== undefined || t.type === "tel");

export function DigitInputs() {
  useEffect(() => {
    const onInput = (e: Event) => {
      const el = e.target;
      if (!applies(el)) return;
      const v = el.value;
      const fixed = clean(el, v);
      if (fixed === v) return;
      // keep the caret where the user was typing
      const caret = el.selectionStart ?? v.length;
      // the prototype's setter: React tracks the element's own "value" setter and would take the corrected value as
      // already known, so a controlled field's onChange would never fire
      nativeValue?.call(el, fixed);
      const at = clean(el, v.slice(0, caret)).length;
      el.setSelectionRange(at, at);
    };
    document.addEventListener("input", onInput, true);
    return () => document.removeEventListener("input", onInput, true);
  }, []);
  return null;
}

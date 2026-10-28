// Bangla / English digits — one place for input sanitising, display and search (browser and server).
//
//   "১২451৩৩"          → toAsciiDigits → "1245133"
//   "১,২৫০.৫০ টাকা"    → sanitizeNumber → "1250.50"   (a quantity / rate / amount field, as typed)
//   "১২,৫০০"           → normalizeNumericInput → "12500"  (a submitted form value, on the server)
// Ordinary text keeps its digits exactly as typed ("Miniket চাল ৫০kg"); only numeric values are converted.

const BN = "০১২৩৪৫৬৭৮৯";

/** Bangla digits → English (0-9); everything else unchanged. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));
}

/** English digits → Bangla; everything else unchanged. */
export function toBanglaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => BN[Number(d)]);
}

export const hasBanglaDigits = (input: string) => /[০-৯]/.test(input);

/**
 * A number typed in any mix of Bangla / English digits → a plain decimal string: digits, one leading "-", one ".".
 * Grouping commas, spaces and currency text are dropped. "" when nothing numeric is left.
 */
export function sanitizeNumber(input: string, opts: { negative?: boolean; decimal?: boolean } = {}): string {
  const { negative = true, decimal = true } = opts;
  const s = toAsciiDigits(input).replace(/[٫⎖]/g, ".");
  let out = "";
  let dot = false;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch === "." && decimal && !dot) {
      out += ".";
      dot = true;
    } else if (ch === "-" && negative && out === "") out = "-";
  }
  return out;
}

/**
 * A submitted form value, digits made English where the value is numeric:
 *   a number ("১২451৩৩", "১,২৫,০০০.৫০", "-৩")             → "1245133", "125000.50", "-3"   (grouping commas dropped)
 *   only digits and separators ("০১৭…, ০১৮…", "২০২৬-১০-২৮") → digits made English, separators kept
 *   any other text ("Miniket চাল ৫০kg")                      → unchanged
 */
export function normalizeNumericInput(value: string): string {
  const t = toAsciiDigits(value).trim();
  if (/^[+-]?\d+(\.\d+)?$/.test(t) || /^[+-]?\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(t)) return t.replace(/,/g, "");
  if (hasBanglaDigits(value) && /^[\d\s+\-().,/:]+$/.test(t)) return toAsciiDigits(value);
  return value;
}

/** Search terms for both digit scripts: "চাল 50" also finds "চাল ৫০" (and the other way round). */
export function digitVariants(q: string): string[] {
  return [...new Set([q, toAsciiDigits(q), toBanglaDigits(q)])];
}

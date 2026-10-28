// Amount in Bangla words for receipts and invoices (South-Asian grouping: কোটি / লক্ষ / হাজার / শত).
// Bangla number names 0–99 are irregular, hence the full table.

const UNITS = [
  "শূন্য", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়",
  "দশ", "এগারো", "বারো", "তেরো", "চৌদ্দ", "পনেরো", "ষোল", "সতেরো", "আঠারো", "উনিশ",
  "বিশ", "একুশ", "বাইশ", "তেইশ", "চব্বিশ", "পঁচিশ", "ছাব্বিশ", "সাতাশ", "আটাশ", "উনত্রিশ",
  "ত্রিশ", "একত্রিশ", "বত্রিশ", "তেত্রিশ", "চৌত্রিশ", "পঁয়ত্রিশ", "ছত্রিশ", "সাঁইত্রিশ", "আটত্রিশ", "উনচল্লিশ",
  "চল্লিশ", "একচল্লিশ", "বিয়াল্লিশ", "তেতাল্লিশ", "চুয়াল্লিশ", "পঁয়তাল্লিশ", "ছেচল্লিশ", "সাতচল্লিশ", "আটচল্লিশ", "উনপঞ্চাশ",
  "পঞ্চাশ", "একান্ন", "বাহান্ন", "তিপ্পান্ন", "চুয়ান্ন", "পঞ্চান্ন", "ছাপ্পান্ন", "সাতান্ন", "আটান্ন", "উনষাট",
  "ষাট", "একষট্টি", "বাষট্টি", "তেষট্টি", "চৌষট্টি", "পঁয়ষট্টি", "ছেষট্টি", "সাতষট্টি", "আটষট্টি", "উনসত্তর",
  "সত্তর", "একাত্তর", "বাহাত্তর", "তিয়াত্তর", "চুয়াত্তর", "পঁচাত্তর", "ছিয়াত্তর", "সাতাত্তর", "আটাত্তর", "উনআশি",
  "আশি", "একাশি", "বিরাশি", "তিরাশি", "চুরাশি", "পঁচাশি", "ছিয়াশি", "সাতাশি", "আটাশি", "উননব্বই",
  "নব্বই", "একানব্বই", "বিরানব্বই", "তিরানব্বই", "চুরানব্বই", "পঁচানব্বই", "ছিয়ানব্বই", "সাতানব্বই", "আটানব্বই", "নিরানব্বই",
];

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${UNITS[h]} শত`);
  if (r) parts.push(UNITS[r]);
  return parts.join(" ");
}

/** Integer → Bangla words (supports up to hundreds of crores). */
export function numberToBanglaWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return UNITS[0];
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1_000);
  n %= 1_000;
  if (crore) parts.push(`${crore >= 100 ? numberToBanglaWords(crore) : UNITS[crore]} কোটি`);
  if (lakh) parts.push(`${UNITS[lakh]} লক্ষ`);
  if (thousand) parts.push(`${UNITS[thousand]} হাজার`);
  if (n) parts.push(below1000(n));
  return parts.join(" ");
}

/** 1234.5 → "এক হাজার দুই শত চৌত্রিশ টাকা পঞ্চাশ পয়সা মাত্র" */
export function amountInBanglaWords(amount: number): string {
  const taka = Math.floor(Math.abs(amount) + 1e-9);
  const paisa = Math.round((Math.abs(amount) - taka) * 100);
  let s = `${numberToBanglaWords(taka)} টাকা`;
  if (paisa) s += ` ${UNITS[paisa]} পয়সা`;
  return `${amount < 0 ? "ঋণাত্মক " : ""}${s} মাত্র`;
}

// English, same South-Asian grouping (Crore / Lakh / Thousand / Hundred) — how amounts are written in Bangladesh.
const EN_UNITS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const EN_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function enBelow100(n: number): string {
  return n < 20 ? EN_UNITS[n] : `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? `-${EN_UNITS[n % 10]}` : ""}`;
}

function enBelow1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${EN_UNITS[h]} Hundred` : "", r ? enBelow100(r) : ""].filter(Boolean).join(" ");
}

/** Integer → English words: 12_50_000 → "Twelve Lakh Fifty Thousand". */
export function numberToEnglishWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return EN_UNITS[0];
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1_000);
  n %= 1_000;
  if (crore) parts.push(`${crore >= 100 ? numberToEnglishWords(crore) : enBelow100(crore)} Crore`);
  if (lakh) parts.push(`${enBelow100(lakh)} Lakh`);
  if (thousand) parts.push(`${enBelow100(thousand)} Thousand`);
  if (n) parts.push(enBelow1000(n));
  return parts.join(" ");
}

/** 1234.5 → "One Thousand Two Hundred Thirty-Four Taka and Fifty Paisa Only" */
export function amountInEnglishWords(amount: number): string {
  const taka = Math.floor(Math.abs(amount) + 1e-9);
  const paisa = Math.round((Math.abs(amount) - taka) * 100);
  let s = `${numberToEnglishWords(taka)} Taka`;
  if (paisa) s += ` and ${enBelow100(paisa)} Paisa`;
  return `${amount < 0 ? "Minus " : ""}${s} Only`;
}

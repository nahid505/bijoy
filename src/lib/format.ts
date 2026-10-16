// Bangla-first formatting helpers (safe for both server and client).

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

export function toBnDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

const numberFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const qtyFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });

/** 1234567.5 -> "১২,৩৪,৫৬৭.৫০" (South-Asian grouping, Bangla digits) */
export function formatNumber(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return toBnDigits(numberFormatter.format(Number.isFinite(n) ? n : 0));
}

export function formatQty(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return toBnDigits(qtyFormatter.format(Number.isFinite(n) ? n : 0));
}

export function formatMoney(value: number | string | null | undefined, symbol = "৳"): string {
  const n = Number(value ?? 0);
  const sign = n < 0 ? "-" : "";
  return `${sign}${symbol} ${formatNumber(Math.abs(n))}`;
}

const BN_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

// All dates are displayed in Bangladesh time regardless of server timezone.
// Date-only business fields (sale date etc.) are stored as UTC midnight of the chosen day,
// which is 06:00 the same day in Asia/Dhaka, so they always render on the correct day.
export const APP_TIMEZONE = "Asia/Dhaka";

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function dateParts(d: Date) {
  const parts = Object.fromEntries(partsFormatter.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: Date | string | null | undefined): string {
  const d = parseDate(value);
  if (!d) return "—";
  const p = dateParts(d);
  return `${toBnDigits(Number(p.day))} ${BN_MONTHS[Number(p.month) - 1]} ${toBnDigits(p.year)}`;
}

export function formatDateTime(value: Date | string | null | undefined): string {
  const d = parseDate(value);
  if (!d) return "—";
  const p = dateParts(d);
  return `${formatDate(d)}, ${toBnDigits(`${p.hour}:${p.minute}`)}`;
}

/** Date -> "YYYY-MM-DD" (Bangladesh calendar day) for <input type="date"> and URL filters. */
export function toDateInput(value: Date | string = new Date()): string {
  const d = parseDate(value) ?? new Date();
  const p = dateParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "YYYY-MM-DD" -> [start, end) Date range (UTC midnight boundaries, matching stored date-only values). */
/** A YYYY-MM-DD date from a query string, or today (daily reports). */
export function dayOrToday(value?: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : toDateInput();
}

/** "2026-10-14" ± days → "2026-10-13" (calendar dates, no time zone). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayRange(from?: string, to?: string): { gte?: Date; lt?: Date } {
  const valid = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const f = valid(from);
  const t = valid(to);
  const range: { gte?: Date; lt?: Date } = {};
  if (f) range.gte = new Date(`${f}T00:00:00.000Z`);
  if (t) {
    const end = new Date(`${t}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    range.lt = end;
  }
  return range;
}

/** First day of the current month (Bangladesh time) as "YYYY-MM-DD". */
export function monthStartInput(): string {
  return `${toDateInput().slice(0, 8)}01`;
}

/**
 * Ledger balance (debit − credit) shown with its side: "৳ ১,২০০.০০ ডেবিট" / "… ক্রেডিট".
 */
export function formatDrCr(value: number | string | null | undefined, symbol = "৳"): string {
  const n = Number(value ?? 0);
  if (Math.abs(n) < 0.005) return `${symbol} ${formatNumber(0)}`;
  return `${symbol} ${formatNumber(Math.abs(n))} ${n > 0 ? "ডেবিট" : "ক্রেডিট"}`;
}

export const MONTH_NAMES = BN_MONTHS;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "নগদ",
  BANK: "ব্যাংক",
  MOBILE_BANKING: "মোবাইল ব্যাংকিং",
  CHEQUE: "চেক",
};

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  SALE: "বিক্রয়",
  PURCHASE: "ক্রয়",
  INCOME: "আয়",
  EXPENSE: "ব্যয়",
  PAYMENT_RECEIVED: "পেমেন্ট গ্রহণ",
  PAYMENT_PAID: "পেমেন্ট প্রদান",
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "তৈরি",
  UPDATE: "হালনাগাদ",
  DELETE: "মুছে ফেলা",
  LOGIN: "লগইন",
  LOGOUT: "লগআউট",
  LOGIN_FAILED: "ব্যর্থ লগইন",
};

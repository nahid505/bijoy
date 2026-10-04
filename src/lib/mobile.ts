// Bangladeshi mobile numbers: accepts 01XXXXXXXXX, +8801XXXXXXXXX, 8801XXXXXXXXX, 008801…,
// with spaces / dashes and Bangla digits, and stores one canonical form: 01XXXXXXXXX
// (operator codes 013–019).

const BN = "০১২৩৪৫৬৭৮৯";

export function normalizeBdMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  const ascii = input.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));
  if (/[^\d+\s\-().]/.test(ascii)) return null;
  let digits = ascii.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) digits = digits.slice(2); // 8801… → 01…
  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

export const looksLikeEmail = (s: string) => s.includes("@");

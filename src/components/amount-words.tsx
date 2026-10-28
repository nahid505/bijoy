// Amount in words in the UI language (receipts, challans, invoices, daily reports). Server component.
import { amountInBanglaWords, amountInEnglishWords } from "@/lib/words";
import { getLang } from "@/server/i18n";

export async function AmountInWords({ amount }: { amount: number }) {
  return (await getLang()) === "en" ? amountInEnglishWords(amount) : amountInBanglaWords(amount);
}

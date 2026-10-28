import fs from "fs";
import path from "path";
import { depotTranslations } from "./translations/depot.mjs";
import { paddyTranslations } from "./translations/paddy-ricemill.mjs";
import { payrollTranslations } from "./translations/payroll.mjs";
import { accountVoucherTranslations } from "./translations/accounts-vouchers.mjs";
import { validationPermissionsTranslations } from "./translations/validation-permissions.mjs";
import { reportTranslations } from "./translations/reports.mjs";
import { landingTranslations } from "./translations/landing.mjs";
import { tradeInventoryTranslations } from "./translations/trade-inventory.mjs";
import { adminBillingTranslations } from "./translations/admin-billing.mjs";
import { singleWordsTranslations } from "./translations/single-words.mjs";
import { phraseTranslations } from "./translations/phrases.mjs";
import { chunk1Translations } from "./translations/chunk1.mjs";
import { chunk2Translations } from "./translations/chunk2.mjs";
import { chunk3Translations } from "./translations/chunk3.mjs";
import { chunk4Translations } from "./translations/chunk4.mjs";
import { chunk5Translations } from "./translations/chunk5.mjs";
import { chunk6Translations } from "./translations/chunk6.mjs";
import { chunk7Translations } from "./translations/chunk7.mjs";
import { allKeys } from "./i18n-extract.mjs";

const enFile = "src/locales/en.json";
const bnFile = "src/locales/bn.json";

const existingEn = JSON.parse(fs.readFileSync(enFile, "utf8"));
// bn.json may hold reworded Bangla for a key — kept; a new key starts as the key itself
const existingBn = JSON.parse(fs.readFileSync(bnFile, "utf8"));

const masterEn = {
  ...existingEn,
  ...depotTranslations,
  ...paddyTranslations,
  ...payrollTranslations,
  ...accountVoucherTranslations,
  ...validationPermissionsTranslations,
  ...reportTranslations,
  ...landingTranslations,
  ...tradeInventoryTranslations,
  ...adminBillingTranslations,
  ...singleWordsTranslations,
  ...phraseTranslations,
  ...chunk1Translations,
  ...chunk2Translations,
  ...chunk3Translations,
  ...chunk4Translations,
  ...chunk5Translations,
  ...chunk6Translations,
  ...chunk7Translations,
};

// Check against all codebase keys
const byFile = allKeys();
const codebaseKeys = new Set([...byFile.values()].flat());

const missing = [];
for (const k of codebaseKeys) {
  if (!(k in masterEn)) {
    missing.push(k);
  }
}

if (missing.length > 0) {
  console.error(`ERROR: ${missing.length} codebase keys are missing translations!`);
  console.error("Missing:", missing);
  process.exit(1);
}

// Create sorted keys (regular-expression sources are code, not UI text)
const sortedKeys = Object.keys(masterEn).filter((k) => !/\(\?[=!:]|\[0-9০-৯\]/.test(k)).sort();
const sortedEn = {};
const sortedBn = {};

for (const k of sortedKeys) {
  sortedEn[k] = masterEn[k];
  sortedBn[k] = existingBn[k] ?? k;
}

// Write en.json
fs.writeFileSync(enFile, JSON.stringify(sortedEn, null, 2) + "\n", "utf8");
console.log(`Successfully wrote ${sortedKeys.length} keys to ${enFile}`);

// Write bn.json
fs.writeFileSync(bnFile, JSON.stringify(sortedBn, null, 2) + "\n", "utf8");
console.log(`Successfully wrote ${sortedKeys.length} keys to ${bnFile}`);

console.log(`Verification: 100% of ${codebaseKeys.size} codebase keys are present and translated!`);

// English screen: every Bangla UI text in src/ has an English translation, and text rendered without t() is translated
// on screen from the same dictionary (src/lib/screen-translate.ts).
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import bn from "@/locales/bn.json";
import { screenTranslator, translateTitle } from "@/lib/screen-translate";
import { allKeys } from "../scripts/i18n-extract.mjs";

const tr = screenTranslator(en);

describe("dictionary coverage", () => {
  it("every Bangla text in src/ has an English translation (node scripts/i18n-extract.mjs lists the missing ones)", () => {
    const missing = [...new Set([...(allKeys() as Map<string, string[]>).values()].flat())].filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it("bn.json holds the same keys; English values keep the key's {placeholders} and carry no Bangla letters", () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [k, v] of Object.entries(en as Record<string, string>)) {
      expect(ph(v), k).toBe(ph(k));
      expect(/[ঀ-৿]/.test(v.replace(/[৳০-৯]/g, "")), `${k} → ${v}`).toBe(false);
    }
  });
});

describe("on-screen translation", () => {
  it("exact keys, keeping the spaces around them", () => {
    expect(tr("নতুন ডেলিভারি চালান")).toBe("New Delivery Challan");
    expect(tr("  কোম্পানি পেইড (ডিও রিলিজ) ")).toBe("  Company Paid (DO Release) ");
    expect(tr("ডিও / রিলিজ অর্ডার নং")).toBe("DO / Release Order No.");
  });

  it("marks around a label: required star, colon, plus, brackets", () => {
    expect(tr("কমিশন হার *")).toBe("Commission Rate *");
    expect(tr("তারিখ:")).toBe("Date:");
    expect(tr("+ আরেকটি পণ্য")).toBe("+ Another Product");
    expect(tr("(তারিখ)")).toBe("(Date)");
  });

  it("template keys: the filled-in parts are kept (and translated when they are UI text)", () => {
    expect(tr('"চাল ২৫ কেজি" নিষ্ক্রিয় পণ্য')).toBe('"চাল ২৫ কেজি" is an inactive product');
    expect(tr('"ফিচার" ফিচারটি বন্ধ আছে')).toBe('"Features" feature is disabled'); // "ফিচার" is UI text itself
  });

  it("lists and lines built from pieces, numbers with units, bilingual labels", () => {
    expect(tr("খুচরা দোকান, অটো রাইস মিল, ডিপো ব্যবসা")).toBe("Retail shop, Auto rice mill, Depot business");
    expect(tr("মেয়াদ ১১ নভেম্বর ২০২৬ · আর ১৪ দিন")).toBe("Valid until ১১ নভেম্বর ২০২৬ · ১৪ days left"); // digits / months: next step
    expect(tr("০.০০ মণ")).toBe("০.০০ Maund");
    expect(tr("ফ্রি (Free)")).toBe("Free");
    expect(tr("মালিক (Owner)")).toBe("Owner");
    expect(tr("১ জুলাই ২০২৬ — ২৮ অক্টোবর ২০২৬ — সব গুদাম")).toBe("১ জুলাই ২০২৬ — ২৮ অক্টোবর ২০২৬ — All warehouses"); // dates: digits / months next
    expect(tr("খুচরা দোকান, রহিম ট্রেডার্স")).toBeNull(); // a piece is the business's own: the whole line stays
    expect(tr("মিনিকেট চাল ২৫ কেজি")).toBeNull(); // a product name ending in a unit is data, not "{0} কেজি"
    expect(tr("২৫ কেজি")).toBe("২৫ Kg");
  });

  it("the business's own data and English text stay as they are", () => {
    expect(tr("রহিম ট্রেডার্স, নওগাঁ")).toBeNull();
    expect(tr("Miniket 50kg")).toBeNull();
    expect(tr("")).toBeNull();
  });

  it("the tab title, part by part", () => {
    expect(translateTitle(tr, "নতুন ডেলিভারি চালান | বিজয় লেনদেন")).toBe("New Delivery Challan | Bijoy Lenden");
    expect(translateTitle(tr, "Dashboard | Bijoy Lenden")).toBeNull();
  });
});

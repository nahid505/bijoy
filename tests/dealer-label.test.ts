import { describe, expect, it } from "vitest";
import { dealerLabel } from "@/lib/depot";

describe("dealerLabel (প্রতিষ্ঠানের নাম (মালিকের নাম))", () => {
  it("shop name with the owner in brackets", () => {
    expect(dealerLabel("মেসার্স রহমান ট্রেডার্স", "মোঃ আব্দুর রহমান")).toBe("মেসার্স রহমান ট্রেডার্স (মোঃ আব্দুর রহমান)");
  });
  it("no owner, a blank owner or the same name → just the shop name", () => {
    expect(dealerLabel("রহিম ডিলার", null)).toBe("রহিম ডিলার");
    expect(dealerLabel("রহিম ডিলার", "  ")).toBe("রহিম ডিলার");
    expect(dealerLabel("Rahim Store", "rahim store")).toBe("Rahim Store");
  });
});

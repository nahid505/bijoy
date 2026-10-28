// Stored (Bangla) notification texts shown in English — samples built exactly as the services build them.
import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatQty, toBnDigits } from "@/lib/format";
import { localizeNotification } from "@/lib/notification-text";

const en = (text: string) => localizeNotification("en", text, { "প্রিমিয়াম": "Premium", "ফ্রি": "Free", "বেসিক": "Basic" });
const day = new Date("2026-11-15T00:00:00.000Z");

describe("notification texts in English", () => {
  it("Bangla stays as stored", () => {
    expect(localizeNotification("bn", "কম স্টক: চাল")).toBe("কম স্টক: চাল");
  });

  it("stock and expiry (names kept)", () => {
    expect(en("কম স্টক: Miniket চাল")).toBe("Low stock: Miniket চাল");
    expect(en("ডিপো — স্টক শেষ: সিমেন্ট")).toBe("Depot — out of stock: সিমেন্ট");
    expect(en(`চাল — মজুদ ${formatQty(3)} কেজি, সর্বনিম্ন সীমা ${formatQty(10)} কেজি।`)).toBe(`চাল — stock ${formatQty(3)} কেজি, minimum ${formatQty(10)} কেজি.`);
    expect(en(`${toBnDigits(7)} দিনের মধ্যে মেয়াদ শেষ: প্যারাসিটামল`)).toBe(`Expires within ${toBnDigits(7)} days: প্যারাসিটামল`);
    expect(en(`প্যারাসিটামল — ব্যাচ B-1 এর মেয়াদ ${toBnDigits(5)} দিন পর (${formatDate(day)}) শেষ হবে। মজুদ ${formatQty(20)} পিস।`))
      .toBe(`প্যারাসিটামল — batch B-1 expires in ${toBnDigits(5)} days (${formatDate(day)}). Stock ${formatQty(20)} পিস.`);
    expect(en(`প্যারাসিটামল — ব্যাচ B-1 এর মেয়াদ ${formatDate(day)} তারিখে শেষ হয়েছে। মজুদ ${formatQty(2)} পিস।`)).toBe(`প্যারাসিটামল — batch B-1 expired on ${formatDate(day)}. Stock ${formatQty(2)} পিস.`);
    expect(en("বকেয়া মেয়াদোত্তীর্ণ: রহিম")).toBe("Overdue dues: রহিম");
    expect(en(`রহিম — ${formatMoney(5000)} বকেয়া পরিশোধের তারিখ পেরিয়ে গেছে (সবচেয়ে পুরনো ${toBnDigits(40)} দিন)।`)).toBe(`রহিম — ${formatMoney(5000)} is past its due date (oldest ${toBnDigits(40)} days).`);
  });

  it("subscription (plan names in English)", () => {
    expect(en(`রেজিস্ট্রেশন সফল — ${toBnDigits(14)} দিনের ফ্রি ট্রায়াল শুরু`)).toBe(`Registration successful — ${toBnDigits(14)}-day free trial started`);
    expect(en(`প্রিমিয়াম প্ল্যানের সব ফিচার ${formatDate(day)} পর্যন্ত ফ্রি ব্যবহার করুন। এরপর প্ল্যান নির্বাচন করে পেমেন্ট করলে সব চালু থাকবে।`))
      .toBe(`Use every feature of the Premium plan free until ${formatDate(day)}. Then choose a plan and pay to keep everything on.`);
    expect(en("রেজিস্ট্রেশন সফল — ফ্রি প্ল্যান")).toBe("Registration successful — Free plan");
    expect(en("প্ল্যান আপগ্রেড: প্রিমিয়াম")).toBe("Plan upgraded: Premium");
    expect(en(`বেসিক → প্রিমিয়াম (মেয়াদ ${formatDate(day)} পর্যন্ত)`)).toBe(`Basic → Premium (until ${formatDate(day)})`);
    expect(en("পেমেন্ট ব্যর্থ — প্রিমিয়াম")).toBe("Payment failed — Premium");
    expect(en(`ট্রায়াল শেষ হবে ${toBnDigits(3)} দিন পর`)).toBe(`Trial ends in ${toBnDigits(3)} days`);
    expect(en("সাবস্ক্রিপশন এর মেয়াদ শেষ")).toBe("Subscription has ended");
    expect(en(`প্রিমিয়াম প্ল্যান ${formatDate(day)} পর্যন্ত সক্রিয়। প্ল্যানের সব ফিচার চালু হয়েছে।`)).toBe(`The Premium plan is active until ${formatDate(day)}. Every feature of the plan is on.`);
  });

  it("an unknown shape is shown as stored", () => {
    expect(en("অন্য কোনো বার্তা")).toBe("অন্য কোনো বার্তা");
  });
});

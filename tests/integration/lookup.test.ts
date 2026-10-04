// Customer / supplier / product pickers: the search service, the /api/lookup route (auth, permissions,
// business isolation) and the "create new" actions, against the test database.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => req.headers,
  cookies: async () => ({
    get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void req.cookies.set(name, value),
    delete: (name: string) => void req.cookies.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { prisma } from "@/lib/db";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";
import { registerAction } from "@/server/actions/auth";
import { accountGroupsForCreateAction, quickCreateAccountAction, quickCreatePartyAction, quickCreateProductAction } from "@/server/actions/lookup";
import { BUSINESS_COOKIE, getContext } from "@/server/auth";
import { searchAccounts, searchParties, searchProducts } from "@/server/lookup";
import { saveAccount, saveParty, saveProduct } from "@/server/services/master";
import { createSession } from "@/server/services/sessions";
import { GET as lookupGet } from "@/app/api/lookup/[kind]/route";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";

let n = 0;
const freshMobile = () => `018${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.append(k, v);
  return fd;
};
const toBn = (s: string) => s.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);

async function newBusiness(name: string) {
  const prev = process.env.REGISTRATION_OTP;
  process.env.REGISTRATION_OTP = "false";
  req.cookies.clear();
  try {
    await registerAction(null, form({ businessName: name, ownerName: "মালিক", mobile: freshMobile(), email: "", password: PASSWORD, confirmPassword: PASSWORD }));
  } catch (e) {
    if ((e as Error).message !== "NEXT_REDIRECT") throw e;
  }
  if (prev === undefined) delete process.env.REGISTRATION_OTP;
  else process.env.REGISTRATION_OTP = prev;
  const ctx = (await getContext())!;
  expect(ctx).toBeTruthy();
  return { ctx, cookies: new Map(req.cookies) };
}

/** a staff member of `businessId` with exactly these permissions; returns their session cookies */
async function staff(businessId: string, permissions: string[]) {
  const role = await prisma.role.create({ data: { businessId, name: `role-${Date.now()}-${++n}`, permissions } });
  const user = await prisma.user.create({ data: { name: "স্টাফ", mobile: freshMobile(), passwordHash: "x" } });
  await prisma.membership.create({ data: { userId: user.id, businessId, roleId: role.id } });
  const s = await createSession(prisma, user.id);
  return new Map([[SESSION_COOKIE, await createSessionToken(user.id, s.id)], [BUSINESS_COOKIE, businessId]]);
}

async function get(kind: string, query: string) {
  const res = await lookupGet(new Request(`http://localhost/api/lookup/${kind}?${query}`), { params: Promise.resolve({ kind }) });
  return { status: res.status, body: (await res.json()) as { items?: { id: string; name: string }[]; canCreate?: boolean }, cache: res.headers.get("cache-control") };
}

run("searchable pickers (lookup)", () => {
  let A: Awaited<ReturnType<typeof newBusiness>>;
  let B: Awaited<ReturnType<typeof newBusiness>>;
  let unitA: string;
  const ids = {} as Record<"rahim" | "karim" | "meghna" | "sugar" | "soap" | "zinc" | "otherSugar", string>;
  const rahimMobile = freshMobile();
  const party = (name: string, mobile: string | null) => ({ name, mobile, email: null, address: null, notes: null, openingBalance: 0, creditLimit: 0, creditDays: 0 });
  const product = (name: string, code: string | null, barcode: string | null, unitId: string) => ({
    name, code, barcode, categoryId: null, brandId: null, unitId, purchasePrice: 100, salePrice: 130, wholesalePrice: 0, minStock: 0, openingStock: 0, openingRate: 0, trackBatch: false,
  });

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
    B = await newBusiness("অন্য দোকান");
    const unitB = (await prisma.unit.findFirstOrThrow({ where: { businessId: B.ctx.business.id, name: "পিস" } })).id;
    ids.otherSugar = await saveProduct(B.ctx.svc, product("চিনি (অন্য দোকান)", "SUGAR-B", "1111222233334", unitB));
    await saveParty(B.ctx.svc, "CUSTOMER", party("রহিম (অন্য দোকান)", freshMobile()));

    A = await newBusiness("লুকআপ টেস্ট স্টোর");
    unitA = (await prisma.unit.findFirstOrThrow({ where: { businessId: A.ctx.business.id, name: "পিস" } })).id;
    ids.rahim = (await saveParty(A.ctx.svc, "CUSTOMER", party("রহিম স্টোর", rahimMobile))).accountId;
    ids.karim = (await saveParty(A.ctx.svc, "CUSTOMER", party("করিম ট্রেডার্স", freshMobile()))).accountId;
    ids.meghna = (await saveParty(A.ctx.svc, "SUPPLIER", party("মেঘনা ডিস্ট্রিবিউটর", freshMobile()))).accountId;
    ids.sugar = await saveProduct(A.ctx.svc, product("চিনি", "SUGAR-1", "8901234567890", unitA));
    ids.soap = await saveProduct(A.ctx.svc, product("ABC Soap", "X100", null, unitA));
    ids.zinc = await saveProduct(A.ctx.svc, product("Zinc Tablet", "ABC", null, unitA));
  });
  beforeEach(() => {
    req.cookies = new Map(A.cookies);
  });

  it("finds customers by name, mobile (incl. Bangla digits and +880), ledger code and id — not suppliers", async () => {
    const biz = A.ctx.business.id;
    expect((await searchParties(biz, "CUSTOMER", "রহিম")).map((p) => p.id)).toEqual([ids.rahim]);
    expect((await searchParties(biz, "CUSTOMER", rahimMobile.slice(-6))).map((p) => p.id)).toEqual([ids.rahim]);
    expect((await searchParties(biz, "CUSTOMER", toBn(rahimMobile))).map((p) => p.id)).toEqual([ids.rahim]);
    expect((await searchParties(biz, "CUSTOMER", `+88${rahimMobile}`)).map((p) => p.id)).toEqual([ids.rahim]);
    const [hit] = await searchParties(biz, "CUSTOMER", "রহিম");
    expect(hit).toMatchObject({ name: "রহিম স্টোর", mobile: rahimMobile, balance: 0, overdue: 0 });
    expect((await searchParties(biz, "CUSTOMER", hit.partyId)).map((p) => p.id)).toEqual([ids.rahim]);
    if (hit.code) expect((await searchParties(biz, "CUSTOMER", hit.code)).map((p) => p.id)).toContain(ids.rahim);
    // a mobile stored with formatting is still found by its plain digits / +880 form
    const formatted = `01${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
    const salma = (await saveParty(A.ctx.svc, "CUSTOMER", party("সালমা ভ্যারাইটিজ", `${formatted.slice(0, 5)}-${formatted.slice(5)}`))).accountId;
    expect((await searchParties(biz, "CUSTOMER", formatted)).map((p) => p.id)).toEqual([salma]);
    expect((await searchParties(biz, "CUSTOMER", `+88${formatted}`)).map((p) => p.id)).toEqual([salma]);
    expect(await searchParties(biz, "CUSTOMER", "মেঘনা")).toEqual([]);
    expect((await searchParties(biz, "SUPPLIER", "মেঘনা")).map((p) => p.id)).toEqual([ids.meghna]);
    // empty query lists (alphabetically, limited) — used when the picker opens
    expect((await searchParties(biz, "CUSTOMER", "")).length).toBeGreaterThanOrEqual(2);
  });

  it("finds products by name, SKU, barcode and id; exact code ranks first", async () => {
    const biz = A.ctx.business.id;
    expect((await searchProducts(biz, "চিনি")).map((p) => p.id)).toEqual([ids.sugar]);
    expect((await searchProducts(biz, "sugar-1")).map((p) => p.id)).toEqual([ids.sugar]);
    expect((await searchProducts(biz, "8901234567890")).map((p) => p.id)).toEqual([ids.sugar]);
    expect((await searchProducts(biz, toBn("8901234567890"))).map((p) => p.id)).toEqual([ids.sugar]);
    expect((await searchProducts(biz, ids.sugar)).map((p) => p.id)).toEqual([ids.sugar]);
    // "abc": Zinc Tablet has code ABC exactly, ABC Soap only starts with it
    expect((await searchProducts(biz, "abc")).map((p) => p.id)).toEqual([ids.zinc, ids.soap]);
    const [sugar] = await searchProducts(biz, "", { ids: [ids.sugar] });
    expect(sugar).toMatchObject({ name: "চিনি", code: "SUGAR-1", barcode: "8901234567890", salePrice: 130, purchasePrice: 100, unitId: unitA });
    expect(await searchProducts(biz, "", { batchOnly: true })).toEqual([]);
    expect(await searchProducts(biz, "কিছুই-নেই-এমন")).toEqual([]);
  });

  it("never returns another business's records", async () => {
    const biz = A.ctx.business.id;
    expect((await searchProducts(biz, "চিনি")).every((p) => p.id !== ids.otherSugar)).toBe(true);
    expect(await searchProducts(biz, "1111222233334")).toEqual([]);
    expect(await searchProducts(biz, "", { ids: [ids.otherSugar] })).toEqual([]);
    expect((await searchParties(biz, "CUSTOMER", "অন্য দোকান"))).toEqual([]);
    const r = await get("products", `ids=${ids.otherSugar}`);
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
  });

  it("route: signed-in search, no-store, 401 signed out, 403 without permission, 404 unknown kind", async () => {
    const ok = await get("products", "q=8901234567890");
    expect(ok.status).toBe(200);
    expect(ok.cache).toBe("no-store");
    expect(ok.body.items!.map((p) => p.id)).toEqual([ids.sugar]);
    expect(ok.body.canCreate).toBe(true); // owner
    expect((await get("customers", `q=${rahimMobile}`)).body.items!.map((p) => p.id)).toEqual([ids.rahim]);
    expect((await get("widgets", "q=x")).status).toBe(404);

    req.cookies = new Map();
    expect((await get("customers", "q=রহিম")).status).toBe(401);

    req.cookies = await staff(A.ctx.business.id, ["sales:create"]);
    const sales = await get("customers", "q=রহিম");
    expect(sales.status).toBe(200);
    expect(sales.body.canCreate).toBe(false); // may search, may not add — the picker hides "create new"
    expect((await get("products", "q=চিনি")).status).toBe(200);
    expect((await get("suppliers", "q=মেঘনা")).status).toBe(403);

    req.cookies = await staff(A.ctx.business.id, ["dashboard:view"]);
    for (const kind of ["customers", "suppliers", "products"]) expect((await get(kind, "q=a")).status).toBe(403);
  });

  it("create new: party and product are created, audited and returned ready to use; permissions enforced", async () => {
    const biz = A.ctx.business.id;
    const mobile = freshMobile();
    const c = await quickCreatePartyAction("CUSTOMER", { name: "নতুন কাস্টমার", mobile });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.item).toMatchObject({ name: "নতুন কাস্টমার", mobile, balance: 0 });
    expect((await searchParties(biz, "CUSTOMER", mobile)).map((p) => p.id)).toEqual([c.item.id]);
    expect(await prisma.auditLog.count({ where: { businessId: biz, entity: "Customer", action: "CREATE" } })).toBeGreaterThanOrEqual(1);

    const s = await quickCreatePartyAction("SUPPLIER", { name: "নতুন সরবরাহকারী", mobile: "" });
    expect(s.ok).toBe(true);
    expect(await quickCreatePartyAction("CUSTOMER", { name: "", mobile: "" })).toMatchObject({ ok: false });

    const p = await quickCreateProductAction({ name: "ডাল", code: "DAL-1", barcode: "4006381333931", unitId: unitA, purchasePrice: "90", salePrice: "110" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.item).toMatchObject({ name: "ডাল", code: "DAL-1", salePrice: 110, purchasePrice: 90, stock: 0 });
    expect((await searchProducts(biz, "4006381333931")).map((x) => x.id)).toEqual([p.item.id]);
    // duplicate code is rejected, existing product untouched
    expect((await quickCreateProductAction({ name: "ডাল ২", code: "DAL-1", barcode: "", unitId: unitA, purchasePrice: "", salePrice: "" })).ok).toBe(false);
    // a unit of another business is refused
    const unitB = (await prisma.unit.findFirstOrThrow({ where: { businessId: B.ctx.business.id, name: "পিস" } })).id;
    expect((await quickCreateProductAction({ name: "ভিন্ন", code: "", barcode: "", unitId: unitB, purchasePrice: "", salePrice: "" })).ok).toBe(false);

    // a salesperson-like role may search but not create
    req.cookies = await staff(biz, ["sales:create"]);
    const before = await prisma.customer.count({ where: { businessId: biz } });
    expect((await quickCreatePartyAction("CUSTOMER", { name: "অননুমোদিত", mobile: "" })).ok).toBe(false);
    expect((await quickCreateProductAction({ name: "অননুমোদিত", code: "", barcode: "", unitId: unitA, purchasePrice: "", salePrice: "" })).ok).toBe(false);
    expect(await prisma.customer.count({ where: { businessId: biz } })).toBe(before);
  });

  // ───────── ledger accounts (SearchableAccountSelect)
  it("accounts: Bangla and English names, code, account number, bank, customer name / mobile; scopes", async () => {
    const biz = A.ctx.business.id;
    const group = (key: string) => prisma.accountGroup.findFirstOrThrow({ where: { businessId: biz, systemKey: key } }).then((g) => g.id);
    const bkash = await saveAccount(A.ctx.svc, { name: "বিকাশ মার্চেন্ট", code: "BK-77", groupId: await group("BANK_ACCOUNTS"), description: null, bankName: "bKash Ltd", accountNumber: "01999888777", openingBalance: 0, openingSide: "DR" });
    const idsOf = (r: { items: { id: string }[] }) => r.items.map((a) => a.id);
    const names = (r: { items: { name: string }[] }) => r.items.map((a) => a.name);

    expect(names(await searchAccounts(biz, "বিকাশ"))).toContain("বিকাশ মার্চেন্ট");
    expect(idsOf(await searchAccounts(biz, "bkash"))).toContain(bkash); // English → Bangla name
    expect(names(await searchAccounts(biz, "cash"))[0]).toBe("নগদ ক্যাশ"); // English finds the Bangla cash ledger first
    expect(names(await searchAccounts(biz, "নগদ"))).toContain("নগদ ক্যাশ");
    expect(names(await searchAccounts(biz, "rent"))).toContain("দোকান/অফিস ভাড়া");
    expect(idsOf(await searchAccounts(biz, "bk-77"))[0]).toBe(bkash); // code, case-insensitive, exact first
    expect(names(await searchAccounts(biz, "1001"))[0]).toBe("নগদ ক্যাশ"); // default code
    expect(names(await searchAccounts(biz, "১০০১"))[0]).toBe("নগদ ক্যাশ"); // Bangla digits
    expect(idsOf(await searchAccounts(biz, "888777"))).toEqual([bkash]); // account number
    expect(idsOf(await searchAccounts(biz, "bkash ltd"))[0]).toBe(bkash); // bank name ranks first (the alias also finds "মোবাইল ব্যাংকিং (বিকাশ/নগদ)")
    // customer / supplier ledgers by party name and mobile
    expect(idsOf(await searchAccounts(biz, "রহিম স্টোর"))).toContain(ids.rahim);
    expect(idsOf(await searchAccounts(biz, rahimMobile))).toContain(ids.rahim);
    expect(idsOf(await searchAccounts(biz, "মেঘনা"))).toContain(ids.meghna);

    // scopes: cash = cash + bank + mobile banking; expense = operating expenses only
    const cash = await searchAccounts(biz, "", { scope: "cash" });
    expect(cash.items.every((a) => a.kind === "CASH" || a.kind === "BANK")).toBe(true);
    expect(idsOf(cash)).toContain(bkash);
    expect((await searchAccounts(biz, "", { scope: "cash-in-hand" })).items.every((a) => a.kind === "CASH")).toBe(true);
    expect((await searchAccounts(biz, "", { scope: "bank" })).items.every((a) => a.kind === "BANK")).toBe(true);
    expect(idsOf(await searchAccounts(biz, "রহিম", { scope: "cash" }))).toEqual([]);
    const exp = names(await searchAccounts(biz, "", { scope: "expense", take: 50 }));
    expect(exp).toContain("কর্মচারীর বেতন");
    expect(exp).not.toContain("বিক্রিত পণ্যের ক্রয়মূল্য"); // direct / system expense excluded, as before
    expect(names(await searchAccounts(biz, "বিকাশ", { scope: "expense" }))).toEqual([]);

    // balances come with the results; the empty query lists in chart order, page by page
    const [c] = (await searchAccounts(biz, "1001")).items;
    expect(typeof c.balance).toBe("number");
    const p1 = await searchAccounts(biz, "", { take: 5 });
    const p2 = await searchAccounts(biz, "", { take: 5, offset: 5 });
    expect(p1.hasMore).toBe(true);
    expect(p1.items.length).toBe(5);
    expect(idsOf(p2).some((x) => idsOf(p1).includes(x))).toBe(false);
    expect(await searchAccounts(biz, "কোনো-হিসাব-নেই-এমন")).toEqual({ items: [], hasMore: false });
  });

  it("accounts: never another business, route permissions, create new returns the account ready to select", async () => {
    const biz = A.ctx.business.id;
    const otherCash = await prisma.account.findFirstOrThrow({ where: { businessId: B.ctx.business.id, systemKey: "CASH" } });
    expect(await searchAccounts(biz, "", { ids: [otherCash.id] })).toEqual({ items: [], hasMore: false });
    expect((await searchAccounts(biz, otherCash.id)).items).toEqual([]);

    const r = await get("accounts", "q=cash&scope=cash");
    expect(r.status).toBe(200);
    expect(r.body.canCreate).toBe(true);
    expect((r.body.items ?? []).every((a) => a.id !== otherCash.id)).toBe(true);
    expect((await get("accounts", `ids=${otherCash.id}`)).body.items).toEqual([]);

    // from a cash picker only cash / bank groups are offered and accepted
    const groups = await accountGroupsForCreateAction("cash");
    expect(groups.ok && groups.groups.map((g) => g.systemKey).sort()).toEqual(["BANK_ACCOUNTS", "CASH_IN_HAND"]);
    const bankGroup = groups.ok ? groups.groups.find((g) => g.systemKey === "BANK_ACCOUNTS")!.id : "";
    const code = `NG-${Math.floor(Math.random() * 1e6)}`;
    const created = await quickCreateAccountAction("cash", { name: "নগদ পার্সোনাল", code, groupId: bankGroup, bankName: "Nagad", accountNumber: "01700000000" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.item).toMatchObject({ name: "নগদ পার্সোনাল", kind: "BANK", balance: 0, group: "ব্যাংক ও মোবাইল ব্যাংকিং" });
    expect(created.item.detail).toContain("Nagad");
    expect((await searchAccounts(biz, "nagad", { scope: "cash" })).items.map((a) => a.id)).toContain(created.item.id);
    expect(await prisma.auditLog.count({ where: { businessId: biz, entity: "Account", entityId: created.item.id } })).toBe(1);
    expect(await prisma.journalEntry.count({ where: { accountId: created.item.id } })).toBe(0); // no opening entry: books unchanged

    // a group outside the picker scope, a customer group, a duplicate code, a missing name, another business: refused
    const opex = (await prisma.accountGroup.findFirstOrThrow({ where: { businessId: biz, systemKey: "INDIRECT_EXPENSES" } })).id;
    expect((await quickCreateAccountAction("cash", { name: "ভুল গ্রুপ", code: "", groupId: opex, bankName: "", accountNumber: "" })).ok).toBe(false);
    const debtors = (await prisma.accountGroup.findFirstOrThrow({ where: { businessId: biz, systemKey: "SUNDRY_DEBTORS" } })).id;
    expect((await quickCreateAccountAction("all", { name: "কাস্টমার নয়", code: "", groupId: debtors, bankName: "", accountNumber: "" })).ok).toBe(false);
    expect((await quickCreateAccountAction("all", { name: "আবার", code, groupId: bankGroup, bankName: "", accountNumber: "" })).ok).toBe(false);
    expect((await quickCreateAccountAction("expense", { name: "", code: "", groupId: opex, bankName: "", accountNumber: "" })).ok).toBe(false);
    const otherGroup = (await prisma.accountGroup.findFirstOrThrow({ where: { businessId: B.ctx.business.id, systemKey: "INDIRECT_EXPENSES" } })).id;
    expect((await quickCreateAccountAction("expense", { name: "অন্য ব্যবসার গ্রুপ", code: "", groupId: otherGroup, bankName: "", accountNumber: "" })).ok).toBe(false);
    const internet = await quickCreateAccountAction("expense", { name: "ইন্টারনেট বিল", code: "", groupId: opex, bankName: "", accountNumber: "" });
    expect(internet.ok && internet.item.kind).toBe("GENERAL");
    expect(internet.ok && (await searchAccounts(biz, "ইন্টারনেট", { scope: "expense" })).items.map((a) => a.id)).toContain(internet.ok ? internet.item.id : "");

    // a voucher clerk may search ledgers but not create them
    req.cookies = await staff(biz, ["vouchers:create"]);
    const clerk = await get("accounts", "q=cash");
    expect(clerk.status).toBe(200);
    expect(clerk.body.canCreate).toBe(false);
    expect((await quickCreateAccountAction("all", { name: "অননুমোদিত", code: "", groupId: opex, bankName: "", accountNumber: "" })).ok).toBe(false);
    expect((await accountGroupsForCreateAction("all")).ok).toBe(false);
    req.cookies = await staff(biz, ["dashboard:view"]);
    expect((await get("accounts", "q=cash")).status).toBe(403);
  });
});

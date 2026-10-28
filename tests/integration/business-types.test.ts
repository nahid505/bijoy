// Business types & modules: registration without a type, several types per business (settings / API), the primary type
// the depot checks read, the modules the sidebar shows, owner-only changes, migration of older data and backups.
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
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { isMySql, strList } from "@/lib/dialect";
import { businessModules, normalizeBusinessTypes, primaryBusinessType } from "@/lib/business-types";
import { businessTypesSchema } from "@/lib/validation";
import { DEPOT_CASH_KEY, DEPOT_ROLE } from "@/lib/depot";
import { SESSION_COOKIE, createSessionToken } from "@/lib/session";
import { registerAction } from "@/server/actions/auth";
import { saveBusinessTypesAction } from "@/server/actions/business";
import { BUSINESS_COOKIE, getContext } from "@/server/auth";
import { createBusiness } from "@/server/services/bootstrap";
import { createSession } from "@/server/services/sessions";
import { exportBusiness, restoreBackup } from "@/server/services/backup";
import { GET, PUT } from "@/app/api/settings/company/business-types/route";

const run = process.env.TEST_DATABASE_URL || process.env.TEST_MYSQL_URL ? describe : describe.skip;
const PASSWORD = "Dokan-2026x";
let n = 0;
const freshMobile = () => `015${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}${String(++n % 100).padStart(2, "0")}`;
const form = (o: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
};
const put = (body: unknown, headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost" }) =>
  PUT(new Request("http://localhost/api/settings/company/business-types", { method: "PUT", headers, body: JSON.stringify(body) }));

describe("business types — rules", () => {
  it("modules: none = general; DEPOT alone = depot only; mixed = both", () => {
    expect([...businessModules([])]).toEqual(["TRADING"]);
    expect([...businessModules(["DEPOT"])]).toEqual(["DEPOT"]);
    expect([...businessModules(["RETAIL", "DEPOT"])].sort()).toEqual(["DEPOT", "TRADING"]);
    expect([...businessModules(["PHARMACY"])]).toEqual(["TRADING"]);
  });
  it("primary type: DEPOT when chosen, else the first; the schema normalises and refuses unknown types", () => {
    expect([primaryBusinessType(["WHOLESALE", "DEPOT"]), primaryBusinessType(["GROCERY", "RETAIL"]), primaryBusinessType([])]).toEqual(["DEPOT", "GROCERY", null]);
    expect(businessTypesSchema.parse({ businessTypes: [" depot ", "retail", "RETAIL"] }).businessTypes).toEqual(["RETAIL", "DEPOT"]);
    expect(() => businessTypesSchema.parse({ businessTypes: ["CASINO"] })).toThrow(/অজানা/);
    expect(normalizeBusinessTypes(["x", "Pharmacy", 3])).toEqual(["PHARMACY"]);
  });
});

run("business types — registration, settings, API", () => {
  let owner: { id: string; businessId: string; cookies: Map<string, string> };
  let clerkCookies: Map<string, string>;
  const asOwner = () => void (req.cookies = new Map(owner.cookies));
  const business = () => prisma.business.findUniqueOrThrow({ where: { id: owner.businessId } });

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest-only-0123456789abcdef";
    process.env.REGISTRATION_HOURLY_LIMIT = "100000";
    process.env.REGISTRATION_OTP = "false";
    req.cookies.clear();
    // an old client still sending businessType: ignored
    await registerAction(null, form({ businessName: "ধরন টেস্ট", ownerName: "মালিক", mobile: freshMobile(), email: "", password: PASSWORD, confirmPassword: PASSWORD, businessType: "DEPOT" })).catch((e: Error) => {
      if (e.message !== "NEXT_REDIRECT") throw e;
    });
    const ctx = (await getContext())!;
    owner = { id: ctx.user.id, businessId: ctx.business.id, cookies: new Map(req.cookies) };
    // a manager (business:manage, not the owner)
    const role = await prisma.role.create({ data: { businessId: owner.businessId, name: "ম্যানেজার", permissions: ["business:manage", "dashboard:view"] } });
    const clerk = await prisma.user.create({ data: { name: "ম্যানেজার", email: `bt${Date.now()}@test.local`, passwordHash: "x" } });
    await prisma.membership.create({ data: { businessId: owner.businessId, userId: clerk.id, roleId: role.id } });
    const s = await createSession(prisma, clerk.id);
    clerkCookies = new Map([[SESSION_COOKIE, await createSessionToken(clerk.id, s.id)], [BUSINESS_COOKIE, owner.businessId]]);
  });
  beforeEach(asOwner);

  it("registration creates a general business: no type, no depot role, no depot cash", async () => {
    const b = await business();
    expect([b.businessType, strList(b.businessTypes)]).toEqual([null, []]);
    expect(await prisma.role.count({ where: { businessId: b.id, name: DEPOT_ROLE.name } })).toBe(0);
    expect((await getContext())!.business.businessTypes).toEqual([]);
  });

  it("settings form: the owner picks several types; DEPOT becomes primary and brings the depot role and cash", async () => {
    const r = await saveBusinessTypesAction(null, form({ businessTypes: ["WHOLESALE", "DEPOT", "RETAIL"] }));
    expect(r?.ok).toBe(true);
    const b = await business();
    expect([b.businessType, strList(b.businessTypes)]).toEqual(["DEPOT", ["RETAIL", "WHOLESALE", "DEPOT"]]);
    expect(await prisma.role.count({ where: { businessId: b.id, name: DEPOT_ROLE.name } })).toBe(1);
    expect(await prisma.account.count({ where: { businessId: b.id, systemKey: DEPOT_CASH_KEY } })).toBe(1);
    const ctx = (await getContext())!;
    expect([...businessModules(ctx.business.businessTypes)].sort()).toEqual(["DEPOT", "TRADING"]);
  });

  it("a non-owner with business:manage cannot change them (form or API)", async () => {
    req.cookies = new Map(clerkCookies);
    const r = await saveBusinessTypesAction(null, form({ businessTypes: ["RETAIL"] }));
    expect(r?.ok).toBe(false);
    expect(r?.message).toMatch(/মালিক/);
    expect((await put({ businessTypes: ["RETAIL"] })).status).toBe(403);
    expect(strList((await business()).businessTypes)).toEqual(["RETAIL", "WHOLESALE", "DEPOT"]);
  });

  it("API: GET shows types and modules; PUT validates, refuses cross-origin / non-JSON, saves", async () => {
    expect(await (await GET()).json()).toEqual({ businessTypes: ["RETAIL", "WHOLESALE", "DEPOT"], primary: "DEPOT", modules: ["TRADING", "DEPOT"] });
    expect((await put({ businessTypes: ["NOPE"] })).status).toBe(400);
    expect((await put({ businessTypes: ["RETAIL"] }, { "content-type": "application/json", origin: "https://evil.example" })).status).toBe(403);
    expect((await put({ businessTypes: ["RETAIL"] }, { "content-type": "text/plain" })).status).toBe(415);
    const ok = await put({ businessTypes: ["DEPOT"] });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ businessTypes: ["DEPOT"], primary: "DEPOT", modules: ["DEPOT"] });
    req.cookies.clear();
    expect((await put({ businessTypes: [] })).status).toBe(401);
  });

  it("switching depot off deletes nothing; switching back reuses the role and cash", async () => {
    await put({ businessTypes: ["RETAIL"] });
    let b = await business();
    expect([b.businessType, strList(b.businessTypes)]).toEqual(["RETAIL", ["RETAIL"]]);
    expect(await prisma.account.count({ where: { businessId: b.id, systemKey: DEPOT_CASH_KEY } })).toBe(1);
    await put({ businessTypes: [] });
    b = await business();
    expect([b.businessType, strList(b.businessTypes)]).toEqual([null, []]);
    await put({ businessTypes: ["DEPOT"] });
    expect(await prisma.role.count({ where: { businessId: b.id, name: DEPOT_ROLE.name } })).toBe(1);
    expect(await prisma.account.count({ where: { businessId: b.id, systemKey: DEPOT_CASH_KEY } })).toBe(1);
  });

  it("backups carry the types; an older backup's single type becomes the list", async () => {
    await put({ businessTypes: ["PHARMACY", "DEPOT"] });
    const file = await exportBusiness(owner.businessId);
    const restored = await restoreBackup(JSON.parse(JSON.stringify(file)), owner.id);
    let r = await prisma.business.findUniqueOrThrow({ where: { id: restored.businessId } });
    expect([r.businessType, strList(r.businessTypes)]).toEqual(["DEPOT", ["PHARMACY", "DEPOT"]]);
    const old = JSON.parse(JSON.stringify(file));
    delete old.data.business.businessTypes;
    old.data.business.businessType = "WHOLESALE";
    old.checksum = createHash("sha256").update(JSON.stringify(old.data)).digest("hex"); // re-signed like an export of that time
    const fromOld = await restoreBackup(old, owner.id);
    r = await prisma.business.findUniqueOrThrow({ where: { id: fromOld.businessId } });
    expect([r.businessType, strList(r.businessTypes)]).toEqual(["WHOLESALE", ["WHOLESALE"]]);
  });

  it("createBusiness with a single type (seed / older callers) stores it as the list", async () => {
    const b = await prisma.$transaction((tx) => createBusiness(tx, { name: "এক ধরন", ownerUserId: owner.id, businessType: "DEPOT" }));
    const row = await prisma.business.findUniqueOrThrow({ where: { id: b.id } });
    expect([row.businessType, strList(row.businessTypes)]).toEqual(["DEPOT", ["DEPOT"]]);
  });
});

run("business types — migration", () => {
  it("an existing business keeps its single type as the list", async () => {
    const u = await prisma.user.create({ data: { name: "M", email: `btm${Date.now()}@test.local`, passwordHash: "x" } });
    const b = await prisma.$transaction((tx) => createBusiness(tx, { name: "পুরনো", ownerUserId: u.id }));
    await prisma.business.update({ where: { id: b.id }, data: { businessType: "GROCERY", businessTypes: [] } }); // as before the migration
    const sql = readFileSync(join(process.cwd(), "prisma", ...(isMySql() ? ["mysql"] : []), "migrations", "20261028000000_business_types", "migration.sql"), "utf8");
    const update = sql.split("\n").find((l) => l.startsWith("UPDATE"))!;
    await prisma.$executeRawUnsafe(update.replace(/;\s*$/, "").concat(isMySql() ? ` AND \`id\` = '${b.id}'` : ` AND "id" = '${b.id}'`));
    expect(strList((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).businessTypes)).toEqual(["GROCERY"]);
  });
});

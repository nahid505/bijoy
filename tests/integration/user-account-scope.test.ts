// User-level Account Group and Payment Account Restriction
// ("অনুমোদিত অ্যাকাউন্ট গ্রুপ" এবং "অনুমোদিত পেমেন্ট ক্যাশ/ব্যাংক উৎস")
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBusiness } from "@/server/services/bootstrap";
import { systemAccounts, type Ctx } from "@/server/services/accounting";
import { saveAccount } from "@/server/services/master";
import {
  accountScopeWhere,
  assertPartiesAllowed,
  assertPaymentAccountsAllowed,
  assignedPartiesOf,
  canOpenLedger,
  getAllDescendantGroupIds,
  isRestricted,
  loadPartyScope,
  restrictionsOf,
  saveAssignments,
  type PartyScope,
} from "@/server/party-scope";
import { searchAccounts } from "@/server/lookup";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

run("user account group and payment account restrictions", () => {
  let owner: Ctx;
  let cashier: { id: string };
  let acc: Awaited<ReturnType<typeof systemAccounts>>;

  // Groups hierarchy:
  // Root: "পরিচালন ব্যয়" (OPERATING_EXPENSES)
  //   Child: "অফিস ও ডিপো খরচ" (OFFICE_DEPOT)
  //     Grandchild: "স্টেশনারি ও মনিহারি" (STATIONERY)
  //   Other: "পরিবহন খরচ" (TRANSPORT)
  //   Other Root: "কারখানা পরিচালন ব্যয়" (FACTORY_EXPENSES)
  let grpOperating: string;
  let grpOffice: string;
  let grpStationery: string;
  let grpTransport: string;
  let grpFactory: string;

  // Accounts
  let accDepotCash: string;
  let accMainCash: string;
  let accOfficeRent: string; // in grpOffice
  let accPaper: string; // in grpStationery
  let accTransport: string; // in grpTransport
  let accFactoryLabor: string; // in grpFactory

  let scope: PartyScope;
  const ctxOf = () => ({
    partyScope: scope,
    user: { id: cashier.id },
    business: { id: owner.businessId },
  });

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { name: "Owner User", email: `uas-owner-${Date.now()}@test.local`, passwordHash: "x" },
    });
    const business = await prisma.$transaction((tx) =>
      createBusiness(tx, { name: "গ্রুপ পারমিশন টেস্ট ব্যবসা", ownerUserId: u.id })
    );
    owner = { businessId: business.id, userId: u.id };
    acc = await prisma.$transaction((tx) => systemAccounts(tx, owner.businessId));

    // Create custom account groups with parent-child tree
    const rootGrp = await prisma.accountGroup.create({
      data: { businessId: owner.businessId, name: "পরিচালন ব্যয় (টেস্ট)", nature: "EXPENSE", sortOrder: 1 },
    });
    grpOperating = rootGrp.id;

    const childGrpOffice = await prisma.accountGroup.create({
      data: {
        businessId: owner.businessId,
        name: "অফিস ও ডিপো খরচ (টেস্ট)",
        nature: "EXPENSE",
        parentId: grpOperating,
        sortOrder: 2,
      },
    });
    grpOffice = childGrpOffice.id;

    const childGrpStationery = await prisma.accountGroup.create({
      data: {
        businessId: owner.businessId,
        name: "স্টেশনারি ও মনিহারি (টেস্ট)",
        nature: "EXPENSE",
        parentId: grpOffice,
        sortOrder: 3,
      },
    });
    grpStationery = childGrpStationery.id;

    const childGrpTransport = await prisma.accountGroup.create({
      data: {
        businessId: owner.businessId,
        name: "পরিবহন খরচ (টেস্ট)",
        nature: "EXPENSE",
        parentId: grpOperating,
        sortOrder: 4,
      },
    });
    grpTransport = childGrpTransport.id;

    const grpOther = await prisma.accountGroup.create({
      data: { businessId: owner.businessId, name: "কারখানা ব্যয় (টেস্ট)", nature: "EXPENSE", sortOrder: 5 },
    });
    grpFactory = grpOther.id;

    // Create cash/bank accounts
    const makeAcc = async (name: string, groupId: string, kind: "GENERAL" | "CASH" | "BANK" = "GENERAL") => {
      const a = await prisma.account.create({
        data: {
          businessId: owner.businessId,
          name,
          groupId,
          nature: "EXPENSE",
          kind,
          isActive: true,
        },
      });
      return a.id;
    };

    accDepotCash = await prisma.account.create({
      data: {
        businessId: owner.businessId,
        name: "ডিপো ক্যাশ বাক্স",
        groupId: (await prisma.accountGroup.findFirstOrThrow({ where: { businessId: owner.businessId, systemKey: "CASH_IN_HAND" } })).id,
        nature: "ASSET",
        kind: "CASH",
        isActive: true,
      },
    }).then((x) => x.id);

    accMainCash = acc.CASH;

    accOfficeRent = await makeAcc("অফিস ভাড়া", grpOffice);
    accPaper = await makeAcc("কাগজ ও কলম", grpStationery);
    accTransport = await makeAcc("ট্রাক ভাড়া", grpTransport);
    accFactoryLabor = await makeAcc("কারখানা শ্রমিক মজুরি", grpFactory);

    // Create test user (cashier)
    cashier = await prisma.user.create({
      data: { name: "ডিপো ক্যাশিয়ার", email: `depot-cashier-${Date.now()}@test.local`, passwordHash: "x" },
    });
    const role = await prisma.role.create({
      data: {
        businessId: business.id,
        name: "ডিপো ক্যাশিয়ার রোল",
        permissions: ["accounts:view", "vouchers:view", "vouchers:create", "expense:create", "expense:view"],
      },
    });
    await prisma.membership.create({
      data: { businessId: business.id, userId: cashier.id, roleId: role.id },
    });

    // Assign:
    // AccountGroup: grpOffice ("অফিস ও ডিপো খরচ") -> should auto-include grpStationery!
    // PaymentAccount: accDepotCash ("ডিপো ক্যাশ বাক্স") -> only this cash source allowed!
    await saveAssignments(
      owner.businessId,
      cashier.id,
      [],
      [],
      [],
      [grpOffice],
      [accDepotCash]
    );

    scope = await loadPartyScope(owner.businessId, cashier.id, restrictionsOf(role.permissions, false));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("1. getAllDescendantGroupIds recursively expands parent to child and grandchild subgroups", () => {
    const allGroups = [
      { id: "A", parentId: null },
      { id: "B", parentId: "A" },
      { id: "C", parentId: "B" },
      { id: "D", parentId: "A" },
      { id: "E", parentId: null },
    ];
    // Selecting A expands to [A, B, C, D]
    const fromA = getAllDescendantGroupIds(allGroups, ["A"]);
    expect(new Set(fromA)).toEqual(new Set(["A", "B", "C", "D"]));

    // Selecting B expands to [B, C]
    const fromB = getAllDescendantGroupIds(allGroups, ["B"]);
    expect(new Set(fromB)).toEqual(new Set(["B", "C"]));

    // Empty returns empty
    expect(getAllDescendantGroupIds(allGroups, [])).toEqual([]);
  });

  it("2. assignedPartiesOf returns assigned account groups and payment accounts", async () => {
    const assigned = await assignedPartiesOf(owner.businessId, cashier.id);
    expect(assigned.accountGroupIds).toEqual([grpOffice]);
    expect(assigned.paymentAccountIds).toEqual([accDepotCash]);
  });

  it("3. loadPartyScope expands assigned groups to descendant subgroups and loads payment accounts", () => {
    expect(scope.accountGroups).toBeDefined();
    // grpOffice has child grpStationery, so both must be in scope.accountGroups!
    expect(scope.accountGroups).toContain(grpOffice);
    expect(scope.accountGroups).toContain(grpStationery);
    // Unassigned groups must NOT be in scope.accountGroups
    expect(scope.accountGroups).not.toContain(grpTransport);
    expect(scope.accountGroups).not.toContain(grpFactory);

    // Payment accounts: only accDepotCash is allowed
    expect(scope.paymentAccounts).toEqual([accDepotCash]);
  });

  it("4. isRestricted returns true when accountGroups or paymentAccounts are set", () => {
    expect(isRestricted(ctxOf())).toBe(true);
  });

  it("5. Owner is never restricted even if assignments exist", async () => {
    const ownerScope = await loadPartyScope(owner.businessId, owner.userId, { ...restrictionsOf(["*"], true), isOwner: true });
    expect(ownerScope.accountGroups ?? null).toBeNull();
    expect(ownerScope.paymentAccounts ?? null).toBeNull();
  });

  it("6. accountScopeWhere allows only accounts in assigned groups / subgroups and allowed payment accounts", async () => {
    const ctx = ctxOf();
    const where = accountScopeWhere(ctx);

    const visibleAccounts = await prisma.account.findMany({
      where: {
        businessId: owner.businessId,
        id: { in: [accOfficeRent, accPaper, accTransport, accFactoryLabor, accDepotCash, accMainCash] },
        ...where,
      },
      select: { id: true, name: true },
    });

    const visibleIds = visibleAccounts.map((a) => a.id);
    // "অফিস ভাড়া" (grpOffice) -> allowed
    expect(visibleIds).toContain(accOfficeRent);
    // "কাগজ ও কলম" (grpStationery - subgroup of grpOffice) -> allowed!
    expect(visibleIds).toContain(accPaper);
    // "ডিপো ক্যাশ বাক্স" (accDepotCash) -> allowed
    expect(visibleIds).toContain(accDepotCash);

    // "ট্রাক ভাড়া" (grpTransport) -> NOT allowed (outside assigned group)
    expect(visibleIds).not.toContain(accTransport);
    // "কারখানা মজুরি" (grpFactory) -> NOT allowed (outside assigned group)
    expect(visibleIds).not.toContain(accFactoryLabor);
    // "প্রধান ক্যাশ" (accMainCash) -> NOT allowed (outside assigned payment accounts)
    expect(visibleIds).not.toContain(accMainCash);
  });

  it("7. searchAccounts with scope: 'expense' and scope: 'cash' respects user restrictions", async () => {
    const ctx = ctxOf();

    // Search cash accounts
    const cashResults = await searchAccounts(owner.businessId, "", {
      scope: "cash",
      where: accountScopeWhere(ctx),
    });
    const cashIds = cashResults.items.map((i) => i.id);
    expect(cashIds).toContain(accDepotCash);
    expect(cashIds).not.toContain(accMainCash);

    // Search expense accounts
    const expenseResults = await searchAccounts(owner.businessId, "", {
      scope: "expense",
      where: accountScopeWhere(ctx),
    });
    const expIds = expenseResults.items.map((i) => i.id);
    expect(expIds).toContain(accOfficeRent);
    expect(expIds).toContain(accPaper);
    expect(expIds).not.toContain(accTransport);
    expect(expIds).not.toContain(accFactoryLabor);
  });

  it("8. assertPartiesAllowed passes valid allowed accounts", async () => {
    const ctx = ctxOf();
    // Valid: office rent (allowed group) + depot cash (allowed payment source)
    await expect(assertPartiesAllowed(ctx, [accOfficeRent, accDepotCash])).resolves.not.toThrow();
    // Valid: stationery paper (subgroup of office group) + depot cash
    await expect(assertPartiesAllowed(ctx, [accPaper, accDepotCash])).resolves.not.toThrow();
  });

  it("9. assertPartiesAllowed rejects accounts from unauthorized account groups", async () => {
    const ctx = ctxOf();
    // Unauthorized expense group: accTransport
    await expect(assertPartiesAllowed(ctx, [accTransport, accDepotCash])).rejects.toThrow(
      /হিসাব খাত "ট্রাক ভাড়া" আপনার জন্য নির্ধারিত নয়/
    );

    // Unauthorized expense group: accFactoryLabor
    await expect(assertPartiesAllowed(ctx, [accFactoryLabor, accDepotCash])).rejects.toThrow(
      /হিসাব খাত "কারখানা শ্রমিক মজুরি" আপনার জন্য নির্ধারিত নয়/
    );
  });

  it("10. assertPartiesAllowed and assertPaymentAccountsAllowed reject unauthorized payment cash sources", async () => {
    const ctx = ctxOf();
    // Unauthorized payment source: accMainCash
    await expect(assertPartiesAllowed(ctx, [accOfficeRent, accMainCash])).rejects.toThrow(
      /পেমেন্ট হিসাব/
    );

    await expect(assertPaymentAccountsAllowed(ctx, [accMainCash])).rejects.toThrow(
      /পেমেন্ট হিসাব/
    );
  });

  it("11. canOpenLedger allows assigned groups/subgroups and allowed payment accounts, refuses unauthorized", async () => {
    const ctx = ctxOf();
    expect(await canOpenLedger(ctx, accOfficeRent)).toBe(true);
    expect(await canOpenLedger(ctx, accPaper)).toBe(true);
    expect(await canOpenLedger(ctx, accDepotCash)).toBe(true);

    expect(await canOpenLedger(ctx, accTransport)).toBe(false);
    expect(await canOpenLedger(ctx, accFactoryLabor)).toBe(false);
    expect(await canOpenLedger(ctx, accMainCash)).toBe(false);
  });
});

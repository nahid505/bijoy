// Creates a fully configured business: chart of accounts, units, warehouse, roles, owner membership.
// Deliberately free of "server-only" / Next imports so the seed script (tsx) can reuse it.
import type { Prisma } from "@prisma/client";
import defaults from "../../lib/business-defaults.json";
import { startSubscription } from "./subscriptions";

type Tx = Prisma.TransactionClient;

/** First day of the fiscal year containing `today` (UTC midnight). */
export function fiscalYearStart(today: Date, startMonth: number): Date {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  const year = m >= startMonth ? y : y - 1;
  return new Date(Date.UTC(year, startMonth - 1, 1));
}

const RENAMED_ROLES: Record<string, string> = {
  "অ্যাডমিন": "অ্যাডমিন (Admin)",
  "হিসাবরক্ষক": "হিসাবরক্ষক (Accountant)",
  "বিক্রয়কর্মী": "বিক্রয়কর্মী (Salesperson)",
  "ক্রয় কর্মকর্তা": "ক্রয় কর্মকর্তা (Purchase)",
};

/** Upgrades an existing business to the current default role set (renames legacy names, adds missing roles). */
export async function ensureDefaultRoles(tx: Tx, businessId: string) {
  const existing = await tx.role.findMany({ where: { businessId } });
  const names = new Set(existing.map((r) => r.name));
  for (const [oldName, newName] of Object.entries(RENAMED_ROLES)) {
    const old = existing.find((r) => r.name === oldName);
    if (old && !names.has(newName)) {
      await tx.role.update({ where: { id: old.id }, data: { name: newName } });
      names.add(newName);
    }
  }
  let added = 0;
  for (const r of defaults.roles) {
    if (names.has(r.name)) continue;
    await tx.role.create({ data: { businessId, name: r.name, description: r.description, permissions: r.permissions, isSystem: "system" in r ? Boolean(r.system) : false } });
    added++;
  }
  return added;
}

export async function createBusiness(
  tx: Tx,
  input: { name: string; ownerUserId: string; mobile?: string | null; address?: string | null; fiscalYearStartMonth?: number; businessType?: string | null; planCode?: string | null },
) {
  const fyMonth = input.fiscalYearStartMonth ?? 7;
  const business = await tx.business.create({
    data: {
      name: input.name,
      mobile: input.mobile ?? null,
      address: input.address ?? null,
      businessType: input.businessType ?? null,
      fiscalYearStartMonth: fyMonth,
      booksStartDate: fiscalYearStart(new Date(), fyMonth),
    },
  });
  const businessId = business.id;

  // Account groups
  const groupIds = new Map<string, { id: string; nature: string }>();
  for (const g of defaults.groups) {
    const row = await tx.accountGroup.create({
      data: {
        businessId,
        name: g.name,
        nature: g.nature as Prisma.AccountGroupCreateInput["nature"],
        isDirect: "isDirect" in g ? Boolean(g.isDirect) : false,
        systemKey: g.key,
        sortOrder: g.sort,
      },
    });
    groupIds.set(g.key, { id: row.id, nature: row.nature });
  }

  // Ledgers
  await tx.account.createMany({
    data: defaults.accounts.map((a) => {
      const group = groupIds.get(a.group)!;
      return {
        businessId,
        groupId: group.id,
        nature: group.nature as Prisma.AccountCreateManyInput["nature"],
        name: a.name,
        code: a.code,
        kind: ("kind" in a ? a.kind : "GENERAL") as Prisma.AccountCreateManyInput["kind"],
        systemKey: a.key,
        isSystem: "system" in a ? Boolean(a.system) : false,
      };
    }),
  });

  // Units (base units first)
  const unitIds = new Map<string, string>();
  for (const u of defaults.units.filter((x) => !("base" in x))) {
    const row = await tx.unit.create({ data: { businessId, name: u.name } });
    unitIds.set(u.name, row.id);
  }
  for (const u of defaults.units.filter((x) => "base" in x)) {
    const def = u as { name: string; base: string; factor: number };
    const row = await tx.unit.create({
      data: { businessId, name: def.name, baseUnitId: unitIds.get(def.base)!, factor: def.factor },
    });
    unitIds.set(def.name, row.id);
  }

  await tx.warehouse.create({ data: { businessId, name: defaults.warehouse, isDefault: true } });

  // Roles + owner membership
  let ownerRoleId = "";
  for (const r of defaults.roles) {
    const role = await tx.role.create({
      data: { businessId, name: r.name, description: r.description, permissions: r.permissions, isSystem: "system" in r ? Boolean(r.system) : false },
    });
    if (role.isSystem) ownerRoleId = role.id;
  }
  await tx.membership.create({ data: { businessId, userId: input.ownerUserId, roleId: ownerRoleId } });

  // SaaS: trial (or free plan) subscription
  await startSubscription(tx, business.id, { planCode: input.planCode ?? null, actorUserId: input.ownerUserId });
  return business;
}

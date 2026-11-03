import { prisma } from "@/lib/db";
import { UserError } from "../action-utils";

export interface CreateCompanyGroupInput {
  name: string;
  code?: string | null;
  description?: string | null;
  parentBusinessId?: string | null;
}

export interface AssignBusinessToGroupInput {
  businessId: string;
  groupId: string;
  isParent?: boolean;
  intercompanyCode?: string | null;
}

export interface LinkPartnerInput {
  businessId: string;
  partnerType: "CUSTOMER" | "SUPPLIER";
  partnerId: string;
  linkedBusinessId: string;
}

/**
 * Creates a new Company / Enterprise Group.
 */
export async function createCompanyGroup(input: CreateCompanyGroupInput) {
  const name = input.name.trim();
  if (!name) throw new UserError("গ্রুপের নাম প্রদান করুন");

  const cleanCode = input.code?.trim() || null;
  if (cleanCode) {
    const existing = await prisma.companyGroup.findUnique({
      where: { code: cleanCode },
    });
    if (existing) throw new UserError("এই গ্রুপের কোডটি ইতিমধ্যেই ব্যবহৃত হয়েছে");
  }

  const group = await prisma.companyGroup.create({
    data: {
      name,
      code: cleanCode,
      description: input.description?.trim() || null,
    },
  });

  // If a parent business is designated, assign it immediately
  if (input.parentBusinessId) {
    await prisma.business.update({
      where: { id: input.parentBusinessId },
      data: {
        groupId: group.id,
        isParent: true,
      },
    });
  }

  return group;
}

/**
 * Assigns or updates a business's group association.
 */
export async function assignBusinessToGroup(input: AssignBusinessToGroupInput) {
  const group = await prisma.companyGroup.findUnique({
    where: { id: input.groupId },
  });
  if (!group) throw new UserError("কোম্পানি গ্রুপ পাওয়া যায়নি");

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
  });
  if (!business) throw new UserError("প্রতিষ্ঠান পাওয়া যায়নি");

  // If setting this business as parent, remove parent flag from any existing parent in the group
  if (input.isParent) {
    await prisma.business.updateMany({
      where: { groupId: input.groupId, isParent: true },
      data: { isParent: false },
    });
  }

  return prisma.business.update({
    where: { id: input.businessId },
    data: {
      groupId: input.groupId,
      isParent: input.isParent ?? false,
      intercompanyCode: input.intercompanyCode?.trim() || null,
    },
  });
}

/**
 * Removes a business from its group.
 */
export async function removeBusinessFromGroup(businessId: string) {
  return prisma.business.update({
    where: { id: businessId },
    data: {
      groupId: null,
      isParent: false,
      intercompanyCode: null,
    },
  });
}

/**
 * Lists all sister concerns belonging to the same group as the given business.
 */
export async function listSisterConcerns(businessId: string) {
  const b = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      groupId: true,
      group: {
        include: {
          businesses: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              businessType: true,
              isParent: true,
              intercompanyCode: true,
              mobile: true,
              email: true,
            },
            orderBy: [{ isParent: "desc" }, { name: "asc" }],
          },
        },
      },
    },
  });

  if (!b || !b.group) {
    return {
      inGroup: false,
      group: null,
      sisterConcerns: [],
    };
  }

  return {
    inGroup: true,
    group: {
      id: b.group.id,
      name: b.group.name,
      code: b.group.code,
    },
    sisterConcerns: b.group.businesses,
  };
}

/**
 * Links a Customer or Supplier to a sister concern business in the same group.
 */
export async function linkSisterConcernPartner(input: LinkPartnerInput) {
  const targetBusiness = await prisma.business.findUnique({
    where: { id: input.linkedBusinessId },
  });
  if (!targetBusiness) throw new UserError("সংযুক্ত করার জন্য নির্দিষ্ট প্রতিষ্ঠান পাওয়া যায়নি");

  if (input.partnerType === "CUSTOMER") {
    const customer = await prisma.customer.findFirst({
      where: { id: input.partnerId, businessId: input.businessId },
    });
    if (!customer) throw new UserError("কাস্টমার পাওয়া যায়নি");

    return prisma.customer.update({
      where: { id: input.partnerId },
      data: {
        isSisterConcern: true,
        linkedBusinessId: input.linkedBusinessId,
      },
    });
  } else {
    const supplier = await prisma.supplier.findFirst({
      where: { id: input.partnerId, businessId: input.businessId },
    });
    if (!supplier) throw new UserError("সরবরাহকারী পাওয়া যায়নি");

    return prisma.supplier.update({
      where: { id: input.partnerId },
      data: {
        isSisterConcern: true,
        linkedBusinessId: input.linkedBusinessId,
      },
    });
  }
}

/**
 * Retrieves all inter-company mapped customers and suppliers for a business.
 */
export async function getInterCompanyPartners(businessId: string) {
  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({
      where: { businessId, isSisterConcern: true },
      include: {
        linkedBusiness: {
          select: { id: true, name: true, intercompanyCode: true },
        },
        account: {
          select: { id: true, name: true, code: true },
        },
      },
    }),
    prisma.supplier.findMany({
      where: { businessId, isSisterConcern: true },
      include: {
        linkedBusiness: {
          select: { id: true, name: true, intercompanyCode: true },
        },
        account: {
          select: { id: true, name: true, code: true },
        },
      },
    }),
  ]);

  return { customers, suppliers };
}

/**
 * Returns consolidated group overview (entities, summary stats, sister concerns).
 */
export async function getConsolidatedGroupOverview(groupId: string) {
  const group = await prisma.companyGroup.findUnique({
    where: { id: groupId },
    include: {
      businesses: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          isParent: true,
          intercompanyCode: true,
          businessType: true,
          currency: true,
          currencySymbol: true,
          _count: {
            select: {
              vouchers: true,
              customers: true,
              suppliers: true,
              products: true,
              employees: true,
            },
          },
        },
        orderBy: [{ isParent: "desc" }, { name: "asc" }],
      },
    },
  });

  if (!group) throw new UserError("কোম্পানি গ্রুপ পাওয়া যায়নি");

  return {
    group: {
      id: group.id,
      name: group.name,
      code: group.code,
      description: group.description,
    },
    totalEntities: group.businesses.length,
    entities: group.businesses,
  };
}

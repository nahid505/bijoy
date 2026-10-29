// Auto rice mill (module RICE_MILL) — who may open each rice-mill screen.
import { RICE_MILL_PERMISSIONS, type Permission } from "./permissions";
import { businessModules } from "./business-types";

/**
 * Each list means "any of": the rice-mill permission (a mill-only role, e.g. a scale operator) or the general
 * permission the screen used before, so existing roles keep working. The rice-mill keys are granted only in a
 * rice-mill business and blocked everywhere else (auth), so they never open a screen of another business.
 * The paddy slip and milling-batch screens are shared with the general purchase / production modules.
 */
export const RICE_MILL_ACCESS = {
  /** paddy purchase slips (ধান ক্রয় ও স্কেল): list and slip */
  paddyView: ["auto_rice_mill.procurement:view", "auto_rice_mill.procurement:create", "purchases:view"],
  paddyCreate: ["auto_rice_mill.procurement:create", "purchases:create"],
  paddyEdit: ["auto_rice_mill.procurement:create", "purchases:edit"],
  /** milling batches and recipes (/production) */
  millingView: ["auto_rice_mill.milling:view", "auto_rice_mill.milling:create", "production:view"],
  milling: ["auto_rice_mill.milling:create", "production:manage"],
  /** rice and by-product stock (/rice-mill/stock) */
  stock: ["auto_rice_mill.inventory:view", "inventory:view"],
  /** rice and by-product sales (/rice-mill/sales; new sales use the sales invoice) */
  salesView: ["auto_rice_mill.sales:view", "auto_rice_mill.sales:create", "sales:view"],
  salesCreate: ["auto_rice_mill.sales:create", "sales:create"],
} as const satisfies Record<string, readonly Permission[]>;

/** The first rice-mill screen a role may open (in menu order), or null. */
export function riceMillHome(can: (p: readonly Permission[]) => boolean): string | null {
  const screens: [string, readonly Permission[]][] = [
    ["/purchases/paddy", RICE_MILL_ACCESS.paddyView],
    ["/production", RICE_MILL_ACCESS.millingView],
    ["/rice-mill/stock", RICE_MILL_ACCESS.stock],
    ["/rice-mill/sales", RICE_MILL_ACCESS.salesView],
  ];
  return screens.find(([, p]) => can(p))?.[0] ?? null;
}

/** Rice-mill keys refused in this business: all of them unless its types switch the RICE_MILL module on. */
export function riceMillBlocked(businessTypes: readonly string[]): Permission[] {
  return businessModules(businessTypes).has("RICE_MILL") ? [] : RICE_MILL_PERMISSIONS;
}

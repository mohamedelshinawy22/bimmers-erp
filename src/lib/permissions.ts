import type { Role } from "@prisma/client";

/**
 * RBAC matrix — client-safe.
 *
 * Deliberately separate from `lib/auth.ts` (which is `server-only` because it
 * touches cookies, jose and Prisma) so the sidebar and other client components
 * can hide controls using the *same* matrix the server enforces, instead of
 * hardcoding their own role lists that could drift out of sync.
 *
 * Hiding a control is presentation only. Every permission is still enforced
 * server-side by `requirePermission()`; never rely on the client check alone.
 */
export const PERMISSIONS = {
  "part.read": ["SUPER_ADMIN", "MANAGER", "CASHIER", "STOREKEEPER"],
  "part.write": ["SUPER_ADMIN", "MANAGER", "STOREKEEPER"],
  "part.editCost": ["SUPER_ADMIN", "MANAGER"],
  "part.deactivate": ["SUPER_ADMIN", "MANAGER"],
  "part.bulkAutoTag": ["SUPER_ADMIN", "MANAGER"],
  "part.bulkPrice": ["SUPER_ADMIN", "MANAGER"],
  "part.viewCost": ["SUPER_ADMIN", "MANAGER", "STOREKEEPER"],
  "stock.adjust": ["SUPER_ADMIN", "MANAGER", "STOREKEEPER"],
  "stock.viewLedger": ["SUPER_ADMIN", "MANAGER", "STOREKEEPER"],
  "invoice.read": ["SUPER_ADMIN", "MANAGER", "CASHIER", "STOREKEEPER"],
  "invoice.sale": ["SUPER_ADMIN", "MANAGER", "CASHIER"],
  "invoice.purchase": ["SUPER_ADMIN", "MANAGER", "STOREKEEPER"],
  "invoice.void": ["SUPER_ADMIN", "MANAGER"],
  "invoice.purge": ["SUPER_ADMIN", "MANAGER"],
  "invoice.belowMinPrice": ["SUPER_ADMIN", "MANAGER"],
  "invoice.overrideDiscount": ["SUPER_ADMIN", "MANAGER"],
  "invoice.overrideCreditLimit": ["SUPER_ADMIN", "MANAGER"],
  "account.read": ["SUPER_ADMIN", "MANAGER", "CASHIER", "STOREKEEPER"],
  "account.write": ["SUPER_ADMIN", "MANAGER", "CASHIER"],
  "account.viewStatement": ["SUPER_ADMIN", "MANAGER", "CASHIER"],
  "account.manageCollections": ["SUPER_ADMIN", "MANAGER"],
  "account.quickCreate": ["SUPER_ADMIN", "MANAGER", "CASHIER"],
  "pos.hold": ["SUPER_ADMIN", "MANAGER", "CASHIER"],
  "treasury.read": ["SUPER_ADMIN", "MANAGER", "CASHIER"],
  "treasury.transact": ["SUPER_ADMIN", "MANAGER", "CASHIER"],
  "treasury.transfer": ["SUPER_ADMIN", "MANAGER"],
  "treasury.closeShift": ["SUPER_ADMIN", "MANAGER", "CASHIER"],
  "treasury.manage": ["SUPER_ADMIN", "MANAGER"],
  "reports.dailyMovement": ["SUPER_ADMIN", "MANAGER"],
  "inventory.import": ["SUPER_ADMIN", "MANAGER", "STOREKEEPER"],
  "accounts.import": ["SUPER_ADMIN", "MANAGER"],
  "barcode.manage": ["SUPER_ADMIN", "MANAGER"],
  "system.backup": ["SUPER_ADMIN"],
  "system.diagnostics": ["SUPER_ADMIN", "MANAGER"],
  "system.maintenance": ["SUPER_ADMIN"],
  "settings.read": ["SUPER_ADMIN", "MANAGER"],
  "settings.write": ["SUPER_ADMIN"],
  "user.manage": ["SUPER_ADMIN"],
  "audit.read": ["SUPER_ADMIN", "MANAGER"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "مدير النظام",
  MANAGER: "مدير",
  CASHIER: "كاشير",
  STOREKEEPER: "أمين مخزن",
};

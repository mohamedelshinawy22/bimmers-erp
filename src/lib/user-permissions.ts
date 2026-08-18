import "server-only";

import type { Role, UserPermission } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/errors";
import { can, type Permission } from "@/lib/permissions";
import type { PermissionBooleanKey } from "@/lib/validations/users";

export type UserAccess = {
  userId: string;
  role: Role;
  allowedWarehouseIds: string[];
  allowedTreasuryIds: string[];
  transferToTreasuryId: string | null;
  permissions: UserPermission | null;
};

const legacyRolePermission: Partial<Record<PermissionBooleanKey, Permission>> = {
  canViewParts: "part.read",
  canCreateParts: "part.write",
  canEditParts: "part.write",
  canDeleteParts: "part.deactivate",
  canViewPartLedger: "stock.viewLedger",
  canViewCostPrice: "part.viewCost",
  canViewAccounts: "account.read",
  canCreateAccounts: "account.write",
  canEditAccounts: "account.write",
  canDeleteAccounts: "account.write",
  canViewAccountStatement: "account.viewStatement",
  canViewTreasuryBalance: "treasury.read",
  canManageReceipts: "treasury.transact",
  canTransferTreasury: "treasury.transfer",
  canViewDailyMovementReport: "reports.dailyMovement",
  canCreateSalesInvoices: "invoice.sale",
  canViewSalesInvoices: "invoice.read",
  canCreatePurchaseInvoices: "invoice.purchase",
  canViewPurchaseInvoices: "invoice.read",
  canEditSalesInvoices: "invoice.void",
  canDeleteSalesInvoices: "invoice.void",
  canEditPurchaseInvoices: "invoice.void",
  canDeletePurchaseInvoices: "invoice.void",
  canSalesReturn: "invoice.sale",
  canPurchaseReturn: "invoice.purchase",
  canManageProgram: "settings.write",
  canBackup: "system.backup",
  canManageInventoryAudit: "stock.adjust",
  canManageAdjustments: "stock.adjust",
  canPrintBarcodes: "barcode.manage",
};

export async function getUserAccess(userId: string): Promise<UserAccess> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      allowedWarehouseIds: true,
      allowedTreasuryIds: true,
      transferToTreasuryId: true,
      permissions: true,
    },
  });
  if (!user) throw new ForbiddenError("المستخدم غير موجود أو لم يعد مخولاً.");
  return {
    userId: user.id,
    role: user.role,
    allowedWarehouseIds: user.allowedWarehouseIds,
    allowedTreasuryIds: user.allowedTreasuryIds,
    transferToTreasuryId: user.transferToTreasuryId,
    permissions: user.permissions,
  };
}

/**
 * Per-user capability check. Super administrators always retain recovery access;
 * existing users without a granular record continue to follow the role matrix.
 */
export function hasPermission(user: Pick<UserAccess, "role" | "permissions">, permissionKey: PermissionBooleanKey): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  if (user.permissions) return Boolean(user.permissions[permissionKey]);
  const legacy = legacyRolePermission[permissionKey];
  return legacy ? can(user.role, legacy) : false;
}

export function canUseTreasury(access: UserAccess, treasuryId: string): boolean {
  return access.role === "SUPER_ADMIN" || access.allowedTreasuryIds.length === 0 || access.allowedTreasuryIds.includes(treasuryId);
}

export function canUseWarehouse(access: UserAccess, warehouseId: string): boolean {
  return access.role === "SUPER_ADMIN" || access.allowedWarehouseIds.length === 0 || access.allowedWarehouseIds.includes(warehouseId);
}

export function assertTreasuryAccess(access: UserAccess, treasuryId: string): void {
  if (!canUseTreasury(access, treasuryId)) throw new ForbiddenError("هذه الخزينة غير متاحة للمستخدم الحالي.");
}

export function assertWarehouseAccess(access: UserAccess, warehouseId: string): void {
  if (!canUseWarehouse(access, warehouseId)) throw new ForbiddenError("هذا المخزن غير متاح للمستخدم الحالي.");
}

export function canViewCostPrice(access: UserAccess): boolean {
  return hasPermission(access, "canViewCostPrice");
}

/** Bridges legacy application permissions to the granular operator matrix. */
export function hasApplicationPermission(access: UserAccess, permission: Permission): boolean {
  if (access.role === "SUPER_ADMIN") return true;
  if (!can(access.role, permission)) return false;
  const gate: Partial<Record<Permission, boolean>> = {
    "part.read": hasPermission(access, "canViewParts"),
    "part.write": hasPermission(access, "canCreateParts") || hasPermission(access, "canEditParts"),
    "part.deactivate": hasPermission(access, "canDeleteParts"),
    "part.viewCost": hasPermission(access, "canViewCostPrice"),
    "stock.adjust": hasPermission(access, "canManageAdjustments") || hasPermission(access, "canManageInventoryAudit"),
    "stock.viewLedger": hasPermission(access, "canViewPartLedger"),
    "invoice.read": hasPermission(access, "canViewSalesInvoices") || hasPermission(access, "canViewPurchaseInvoices"),
    "invoice.sale": hasPermission(access, "canCreateSalesInvoices") || hasPermission(access, "canSalesReturn"),
    "invoice.purchase": hasPermission(access, "canCreatePurchaseInvoices") || hasPermission(access, "canPurchaseReturn"),
    "invoice.void": hasPermission(access, "canDeleteSalesInvoices") || hasPermission(access, "canDeletePurchaseInvoices"),
    "invoice.belowMinPrice": hasPermission(access, "canSellBelowMinPrice"),
    "invoice.overrideDiscount": hasPermission(access, "canAddDiscount"),
    "account.read": hasPermission(access, "canViewAccounts"),
    "account.write": hasPermission(access, "canCreateAccounts") || hasPermission(access, "canEditAccounts") || hasPermission(access, "canDeleteAccounts"),
    "account.viewStatement": hasPermission(access, "canViewAccountStatement"),
    "account.manageCollections": hasPermission(access, "canManageReceipts"),
    "account.quickCreate": hasPermission(access, "canCreateAccounts"),
    "treasury.read": hasPermission(access, "canViewTreasuryBalance"),
    "treasury.transact": hasPermission(access, "canManageReceipts"),
    "treasury.transfer": hasPermission(access, "canTransferTreasury"),
    "reports.dailyMovement": hasPermission(access, "canViewDailyMovementReport"),
    "barcode.manage": hasPermission(access, "canPrintBarcodes"),
    "system.backup": hasPermission(access, "canBackup"),
    "settings.write": hasPermission(access, "canManageProgram"),
  };
  return gate[permission] ?? true;
}

import { z } from "zod";

const uuid = z.string().uuid("معرّف غير صالح");
const optionalUuid = z.string().trim().optional().or(z.literal("")).transform((value) => value || undefined).pipe(uuid.optional());
const password = z.string().min(10, "كلمة المرور يجب أن تكون ١٠ خانات على الأقل").max(200).regex(/[A-Za-z]/, "يجب أن تحتوي كلمة المرور على حروف").regex(/[0-9]/, "يجب أن تحتوي كلمة المرور على أرقام");
const bool = z.boolean().default(false);

export const permissionBooleanKeys = [
  "canManageProgram", "canBackup", "canRestoreBackup", "canEditInvoiceNumber", "canEditDateTime", "viewTodayInvoicesOnly", "editTodayInvoicesOnly", "canSendEInvoices",
  "canViewSalesInvoices", "canCreateSalesInvoices", "canEditSalesInvoices", "canDeleteSalesInvoices", "canEditSellingPrice", "canCreditSale", "canEditSaleVat", "canAddDiscount", "canSellBelowMinPrice", "canSellBelowCost", "canSalesReturn", "canViewInvoiceProfit", "canViewQuotations", "canManageQuotations", "canViewPurchaseInvoices", "canCreatePurchaseInvoices", "canEditPurchaseInvoices", "canDeletePurchaseInvoices", "canCreditPurchase", "canEditPurchaseVat", "canPurchaseReturn", "canManageInventoryAudit", "canManageBranchTransfers", "canManageAdjustments", "canManageExpenses", "canManageReceipts", "canTransferTreasury", "canBypassTreasuryImpact",
  "canViewParts", "canCreateParts", "canEditParts", "canDeleteParts", "canViewPartLedger", "canViewStockReport", "canViewCostPrice", "canNegativeSell", "canPrintBarcodes",
  "canViewAccounts", "canCreateAccounts", "canEditAccounts", "canDeleteAccounts", "canViewAccountBalance", "canViewAccountStatement",
  "canViewTreasuryBalance", "canAnalyzeReceipts", "canAnalyzeExpenses", "canAccessAdvancedReports", "canViewDailyMovementReport", "canViewSalesAnalysis", "canViewPurchaseAnalysis",
] as const;

export type PermissionBooleanKey = (typeof permissionBooleanKeys)[number];

const permissionsShape = Object.fromEntries(permissionBooleanKeys.map((key) => [key, bool])) as Record<PermissionBooleanKey, typeof bool>;

export const userPermissionSchema = z.object({
  ...permissionsShape,
  maxDiscountPercent: z.coerce.number().finite("نسبة الخصم غير صالحة").min(0).max(100).default(0),
  maxDiscountValue: z.coerce.number().finite("قيمة الخصم غير صالحة").min(0).max(99_999_999).default(0),
  allowedAccountTypes: z.array(z.enum(["CUSTOMER", "SUPPLIER", "EMPLOYEE"])).max(3).default(["CUSTOMER", "SUPPLIER"]),
});

const userCoreSchema = z.object({
  username: z.string().trim().min(3, "اسم المستخدم قصير جداً").max(50).regex(/^[a-zA-Z0-9._-]+$/, "اسم المستخدم يقبل الحروف الإنجليزية والأرقام فقط"),
  fullName: z.string().trim().min(2, "الاسم الكامل مطلوب").max(120),
  role: z.enum(["SUPER_ADMIN", "MANAGER", "CASHIER", "STOREKEEPER"]),
  isActive: z.boolean().default(true),
  allowedWarehouseIds: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  allowedTreasuryIds: z.array(uuid).max(100).default([]),
  transferToTreasuryId: optionalUuid,
  permissions: userPermissionSchema,
});

export const createManagedUserSchema = userCoreSchema.extend({ password });
export const updateManagedUserSchema = userCoreSchema.extend({ id: uuid, password: password.optional().or(z.literal("")) });

export type UserPermissionInput = z.infer<typeof userPermissionSchema>;
export type CreateManagedUserInput = z.infer<typeof createManagedUserSchema>;
export type UpdateManagedUserInput = z.infer<typeof updateManagedUserSchema>;

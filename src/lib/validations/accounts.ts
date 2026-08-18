import { z } from "zod";
import {
  arabicName,
  nonNegativeMoney,
  optionalText,
  optionalUuid,
  phone,
  positiveMoney,
  uuid,
  vin,
} from "./common";

export const accountTypeSchema = z.enum([
  "CUSTOMER",
  "WORKSHOP_BMW",
  "SUPPLIER",
  "EXPENSE",
  "EMPLOYEE",
  "ADVANCE",
  "PARTNER",
  "OTHER",
]);

export const accountStatusSchema = z.enum(["ACTIVE", "INACTIVE", "UNDER_REVIEW"]);

const openingBalance = z.number().min(-99_999_999.99).max(99_999_999.99).default(0);

export const createAccountSchema = z.object({
  name: arabicName,
  type: accountTypeSchema,
  phone,
  email: z.string().trim().email("بريد إلكتروني غير صالح").optional().or(z.literal("")),
  address: optionalText(300),
  taxNumber: optionalText(50),
  category: optionalText(80),
  creditLimit: nonNegativeMoney.default(0),
  defaultPriceTier: z.enum(["RETAIL", "WHOLESALE"]).default("RETAIL"),
  openingBalance,
  status: accountStatusSchema.default("ACTIVE"),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const quickPosAccountSchema = createAccountSchema.extend({
  phone: z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, "رقم تليفون غير صالح"),
  notes: optionalText(500),
});

export type QuickPosAccountInput = z.infer<typeof quickPosAccountSchema>;

export const updateAccountSchema = z.object({
  id: uuid,
  name: arabicName,
  type: accountTypeSchema,
  phone,
  email: z.string().trim().email("بريد إلكتروني غير صالح").optional().or(z.literal("")),
  address: optionalText(300),
  taxNumber: optionalText(50),
  category: optionalText(80),
  creditLimit: nonNegativeMoney,
  defaultPriceTier: z.enum(["RETAIL", "WHOLESALE"]),
  status: accountStatusSchema.default("ACTIVE"),
  isActive: z.boolean().default(true),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

export const accountListFiltersSchema = z.object({
  query: z.string().trim().max(120).default(""),
  type: accountTypeSchema.or(z.literal("ALL")).default("ALL"),
  category: z.string().trim().max(80).optional(),
  hideZeroBalances: z.boolean().default(false),
  underReviewOnly: z.boolean().default(false),
  inactiveOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

export type AccountListFilters = z.infer<typeof accountListFiltersSchema>;

export const quickVoucherSchema = z.object({
  accountId: uuid,
  type: z.enum(["RECEIPT", "PAYMENT"]),
  amount: positiveMoney,
  treasuryId: uuid,
  notes: optionalText(500),
});

export type QuickVoucherInput = z.infer<typeof quickVoucherSchema>;

export const accountStatementSchema = z.object({
  accountId: uuid,
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export type AccountStatementInput = z.infer<typeof accountStatementSchema>;

export const historicalBalancesSchema = z.object({
  targetDate: z.coerce.date(),
  type: accountTypeSchema.or(z.literal("ALL")).default("ALL"),
});

export type HistoricalBalancesInput = z.infer<typeof historicalBalancesSchema>;

export const createCheckSchema = z.object({
  accountId: uuid,
  direction: z.enum(["RECEIVABLE", "PAYABLE"]),
  checkNumber: z.string().trim().min(2).max(100),
  bankName: optionalText(120),
  amount: positiveMoney,
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date(),
  notes: optionalText(500),
});

export type CreateCheckInput = z.infer<typeof createCheckSchema>;

export const createVehicleSchema = z.object({
  accountId: uuid,
  vin,
  chassisId: optionalUuid,
  engineId: optionalUuid,
  modelYear: z
    .number()
    .int()
    .min(1970, "سنة الموديل قديمة جداً")
    .max(new Date().getFullYear() + 2, "سنة الموديل غير منطقية")
    .optional(),
  plateNumber: optionalText(20),
  notes: optionalText(500),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(3, "اسم المستخدم قصير جداً").max(50),
  password: z.string().min(8, "كلمة المرور يجب أن تكون ٨ خانات على الأقل").max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, "اسم المستخدم قصير جداً")
    .max(50)
    .regex(/^[a-zA-Z0-9._-]+$/, "اسم المستخدم يقبل الحروف الإنجليزية والأرقام فقط"),
  fullName: arabicName,
  password: z
    .string()
    .min(10, "كلمة المرور يجب أن تكون ١٠ خانات على الأقل")
    .max(200)
    .regex(/[A-Za-z]/, "يجب أن تحتوي كلمة المرور على حروف")
    .regex(/[0-9]/, "يجب أن تحتوي كلمة المرور على أرقام"),
  role: z.enum(["SUPER_ADMIN", "MANAGER", "CASHIER", "STOREKEEPER"]),
});

export const updateSettingsSchema = z.object({
  entries: z
    .array(
      z.object({
        key: z.string().trim().min(2).max(80),
        value: z.string().max(2000),
      }),
    )
    .min(1)
    .max(60),
});

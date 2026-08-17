import { z } from "zod";
import { arabicName, nonNegativeMoney, optionalText, optionalUuid, phone, uuid, vin } from "./common";

export const createAccountSchema = z.object({
  name: arabicName,
  type: z.enum(["CUSTOMER", "WORKSHOP_BMW", "SUPPLIER", "EXPENSE"]),
  phone,
  email: z.string().trim().email("بريد إلكتروني غير صالح").optional().or(z.literal("")),
  address: optionalText(300),
  taxNumber: optionalText(50),
  creditLimit: nonNegativeMoney.default(0),
  defaultPriceTier: z.enum(["RETAIL", "WHOLESALE"]).default("RETAIL"),
  openingBalance: z
    .number()
    .min(-99_999_999.99)
    .max(99_999_999.99)
    .default(0),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  id: uuid,
  name: arabicName,
  type: z.enum(["CUSTOMER", "WORKSHOP_BMW", "SUPPLIER", "EXPENSE"]),
  phone,
  email: z.string().trim().email("بريد إلكتروني غير صالح").optional().or(z.literal("")),
  address: optionalText(300),
  taxNumber: optionalText(50),
  creditLimit: nonNegativeMoney,
  defaultPriceTier: z.enum(["RETAIL", "WHOLESALE"]),
  isActive: z.boolean(),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

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

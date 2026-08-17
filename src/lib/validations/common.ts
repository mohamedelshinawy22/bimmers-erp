import { z } from "zod";

export const uuid = z.string().uuid({ message: "معرّف غير صالح" });

export const positiveInt = z
  .number({ error: "يجب إدخال رقم صحيح" })
  .int("يجب إدخال رقم صحيح")
  .positive("يجب أن يكون الرقم أكبر من صفر");

export const nonNegativeMoney = z
  .number({ error: "يجب إدخال قيمة رقمية" })
  .nonnegative("لا يمكن إدخال قيمة سالبة")
  .max(99_999_999.99, "القيمة تتجاوز الحد المسموح")
  .refine((v) => Number.isFinite(v), "قيمة غير صالحة");

export const positiveMoney = z
  .number({ error: "يجب إدخال قيمة رقمية" })
  .positive("يجب أن تكون القيمة أكبر من صفر")
  .max(99_999_999.99, "القيمة تتجاوز الحد المسموح");

/** BMW OEM part numbers are 11 digits; we accept spaced/dashed input and normalise. */
export const oemNumber = z
  .string()
  .trim()
  .min(5, "رقم القطعة قصير جداً")
  .max(30, "رقم القطعة طويل جداً")
  .transform((v) => v.replace(/[\s\-.]/g, "").toUpperCase());

export const vin = z
  .string()
  .trim()
  .toUpperCase()
  .length(17, "رقم الشاسيه (VIN) يجب أن يكون ١٧ خانة")
  .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "رقم الشاسيه لا يجب أن يحتوي على الحروف I أو O أو Q");

export const arabicName = z
  .string()
  .trim()
  .min(2, "الاسم قصير جداً")
  .max(200, "الاسم طويل جداً");

export const phone = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s()]{7,20}$/, "رقم تليفون غير صالح")
  .optional()
  .or(z.literal(""));

export const optionalText = (max = 500) => z.string().trim().max(max).optional().or(z.literal(""));

/** Normalises "" → undefined so optional relations don't get empty strings. */
export const optionalUuid = z
  .union([uuid, z.literal("")])
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v));

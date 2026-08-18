import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { AuthError, BusinessRuleError, ConfigurationError, ForbiddenError } from "./errors";

export type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export const ok = <T>(data: T): ActionResult<T> => ({ success: true, data });
export const fail = (error: string, fieldErrors?: Record<string, string[]>): ActionResult<never> => ({
  success: false,
  error,
  fieldErrors,
});

/** Domain rule violation — message is safe to show to the operator verbatim. */

const PRISMA_MESSAGES: Record<string, (e: Prisma.PrismaClientKnownRequestError) => string> = {
  P2002: (e) => {
    const target = (e.meta?.target as string[] | string | undefined) ?? "";
    const field = Array.isArray(target) ? target.join(", ") : String(target);
    if (field.includes("oemNumber")) return "رقم القطعة الأصلي (OEM) مسجّل بالفعل لصنف آخر.";
    if (field.includes("barcode")) return "الباركود مستخدم بالفعل لصنف آخر.";
    if (field.includes("username")) return "اسم المستخدم مسجّل بالفعل.";
    if (field.includes("accountNumber") || field.includes("code")) return "كود الحساب مستخدم بالفعل";
    if (field.includes("phone")) return "رقم الهاتف مسجل بالفعل لحساب آخر";
    if (field.includes("name")) return "اسم الحساب موجود مسبقاً";
    if (field.includes("invoiceNumber")) return "رقم الفاتورة مستخدم بالفعل، أعد المحاولة.";
    if (field.includes("fullCode")) return "كود موقع التخزين مستخدم بالفعل.";
    return "هذه البيانات مسجّلة بالفعل ولا تقبل التكرار.";
  },
  P2003: () => "لا يمكن إتمام العملية: سجل مرتبط غير موجود.",
  P2025: () => "السجل المطلوب غير موجود أو تم حذفه.",
  P2028: () => "انتهت مهلة العملية بسبب تزاحم على نفس الأصناف. أعد المحاولة.",
  P2034: () => "تعارض في المعاملات المتزامنة (Serialization). أعد المحاولة.",
  P1001: () => "تعذر الاتصال بقاعدة البيانات. تحقق من تشغيل الخدمة.",
  P1002: () => "انتهت مهلة الاتصال بقاعدة البيانات.",
  P1017: () => "قاعدة البيانات أغلقت الاتصال. أعد المحاولة.",
};

/**
 * Single funnel that turns any thrown error into a safe Arabic ActionResult.
 * Internal details are logged server-side and never leaked to the client.
 */
export function toActionError(error: unknown, context: string): ActionResult<never> {
  if (error instanceof ZodError) {
    const flat = z.flattenError(error);
    const fieldErrors: Record<string, string[]> = {};
    for (const [key, messages] of Object.entries(flat.fieldErrors)) {
      if (Array.isArray(messages) && messages.length > 0) fieldErrors[key] = messages;
    }
    const first = Object.values(fieldErrors)[0]?.[0] ?? flat.formErrors[0];
    return fail(first ?? "بيانات غير صالحة.", fieldErrors);
  }
  if (error instanceof BusinessRuleError) return fail(error.message);
  if (error instanceof ForbiddenError) return fail(error.message);
  if (error instanceof AuthError) return fail(error.message);
  if (error instanceof ConfigurationError) {
    // Deployment fault, not user error. Logged with context so it is greppable
    // in the platform logs, and returned verbatim: the message names the
    // offending variable only, never its value.
    console.error(`[${context}] configuration:`, error.message);
    return fail(error.message);
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapper = PRISMA_MESSAGES[error.code];
    console.error(`[${context}] prisma ${error.code}:`, error.message);
    return fail(mapper ? mapper(error) : `خطأ في قاعدة البيانات (${error.code}).`);
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    console.error(`[${context}] prisma validation:`, error.message);
    return fail("بيانات غير متوافقة مع مخطط قاعدة البيانات.");
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    console.error(`[${context}] prisma init:`, error.message);
    return fail("تعذر الاتصال بقاعدة البيانات. تحقق من إعدادات DATABASE_URL.");
  }

  console.error(`[${context}] unexpected:`, error);
  return fail("حدث خطأ غير متوقع. تم تسجيل التفاصيل لدى مسؤول النظام.");
}

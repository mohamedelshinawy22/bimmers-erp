import { TenantRoutingError } from "@/lib/tenant-routing";
import { AuthError, ConfigurationError, ForbiddenError } from "@/lib/errors";

export function safeCopilotErrorMessage(error: unknown): string {
  if (error instanceof AuthError || error instanceof ForbiddenError || error instanceof ConfigurationError) return error.message;
  if (error instanceof TenantRoutingError) return error.safeMessage;
  if (error instanceof Error && ["خدمة المساعد الذكي غير مهيأة حالياً.", "تعذر الاتصال بخدمة المساعد الذكي حالياً."].includes(error.message)) return error.message;
  return "تعذر قراءة بيانات المؤسسة أو معالجة السؤال حالياً. أعد المحاولة، وإذا استمر الخطأ تواصل مع مسؤول النظام.";
}

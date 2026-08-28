import "server-only";

import type { SessionTenantDb } from "@/server/db/get-tenant-db";
import { createScopedCopilotTools } from "@/server/ai/copilot-tools";
import { invokeLLM, type ForgeMessage, type ForgeTool } from "@/server/ai/forge-llm";

const SYSTEM_PROMPT = `أنت Bimmers AI Copilot، مساعد ERP متخصص في قطع غيار BMW ويفهم العربية المصرية والفصحى.
قواعد إلزامية:
1. أجب فقط من نتائج الأدوات الحية. لا تخمّن أو تختلق أي رقم أو اسم أو رصيد.
2. استخدم الأداة المناسبة قبل الإجابة عن أي سؤال يطلب مبيعات أو مخزون أو فاتورة أو سند أو رصيد.
3. التزم بصلاحيات المستخدم والبيانات التي تعيدها الأدوات. لا تحاول الوصول إلى بيانات خارج المستأجر أو تجاوز نتيجة رفض الصلاحية.
4. لا تكشف أسعار التكلفة أو الجملة أو إجمالي خزائن الشركة أو أداء الزملاء لمستخدم غير مدير.
5. إذا لم توجد بيانات، قل ذلك صراحة. استخدم الجنيه المصري (ج.م) والتنسيق العربي الواضح.
6. هذه جلسة استعلام فقط؛ لا تنفذ أي إنشاء أو تعديل أو حذف أو ترحيل مالي.`;

export const copilotTools: ForgeTool[] = [
  { type: "function", function: { name: "getLiveDashboardMetrics", description: "ملخص مبيعات اليوم والخزائن والمديونيات والنواقص؛ للمدير فقط.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "queryProducts", description: "البحث الحي عن الأصناف برقم OEM أو الاسم أو الباركود أو الفئة والتوافق BMW مع الرصيد والأسعار المسموح بها.", parameters: { type: "object", properties: { query: { type: "string" }, chassis: { type: "string" }, engine: { type: "string" }, lowStockOnly: { type: "boolean" } }, additionalProperties: false } } },
  { type: "function", function: { name: "queryInvoices", description: "البحث الحي في فواتير البيع والشراء ضمن فترة أو حساب.", parameters: { type: "object", properties: { type: { type: "string", enum: ["SALE", "PURCHASE"] }, dateFrom: { type: "string" }, dateTo: { type: "string" }, accountName: { type: "string" } }, additionalProperties: false } } },
  { type: "function", function: { name: "queryVouchersAndTreasury", description: "قراءة سندات القبض والصرف وأرصدة الخزائن المصرح بها فقط.", parameters: { type: "object", properties: { type: { type: "string", enum: ["RECEIPT", "PAYMENT"] }, limit: { type: "integer", minimum: 1, maximum: 20 } }, additionalProperties: false } } },
  { type: "function", function: { name: "queryAccountsAndDebts", description: "قراءة أرصدة العملاء والموردين والورش للمدير فقط.", parameters: { type: "object", properties: { search: { type: "string" }, type: { type: "string", enum: ["CUSTOMER", "SUPPLIER", "WORKSHOP_BMW"] }, withDebtsOnly: { type: "boolean" } }, additionalProperties: false } } },
  { type: "function", function: { name: "queryUserPerformanceSummary", description: "مقارنة مبيعات المستخدمين النشطين للمدير فقط.", parameters: { type: "object", properties: { dateFrom: { type: "string" } }, additionalProperties: false } } },
];

const allowedTools = new Set(copilotTools.map((tool) => tool.function.name));
const safeArguments = (value: string) => { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; } };
export type CopilotInputMessage = { role: "user" | "assistant"; content: string };

export function normalizeCopilotMessages(value: unknown): ForgeMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as { role?: unknown; content?: unknown };
    if ((record.role !== "user" && record.role !== "assistant") || typeof record.content !== "string") return [];
    return [{ role: record.role, content: record.content.slice(0, 4000) } as ForgeMessage];
  });
}

export async function runCopilotConversation(tenant: SessionTenantDb, messages: ForgeMessage[]) {
  const dbUser = await tenant.prisma.user.findUnique({ where: { id: tenant.user.id }, select: { allowedTreasuryIds: true } });
  const userContext = { userId: tenant.user.id, fullName: tenant.user.fullName, role: String(tenant.user.role), tenantId: tenant.context.route.tenantId, allowedTreasuryIds: dbUser?.allowedTreasuryIds ?? [] };
  const scopedTools = createScopedCopilotTools(tenant.prisma, userContext);
  const conversation: ForgeMessage[] = [{ role: "system", content: `${SYSTEM_PROMPT}\nالمستخدم الحالي: ${userContext.fullName}؛ الدور: ${userContext.role}.` }, ...messages];
  for (let round = 0; round < 4; round += 1) {
    const completion = await invokeLLM({ messages: conversation, tools: copilotTools, toolChoice: "auto", maxTokens: 900 });
    const assistant = completion.choices?.[0]?.message;
    if (!assistant) return "تعذر تكوين إجابة من خدمة المساعد حالياً.";
    conversation.push(assistant);
    if (!assistant.tool_calls?.length) return assistant.content?.trim() || "لم أجد إجابة نصية للطلب.";
    for (const call of assistant.tool_calls.slice(0, 4)) {
      let output: unknown = { error: "الأداة المطلوبة غير متاحة." };
      if (allowedTools.has(call.function.name)) {
        const fn = scopedTools[call.function.name as keyof typeof scopedTools] as (args: Record<string, unknown>) => Promise<unknown>;
        output = await fn(safeArguments(call.function.arguments));
      }
      conversation.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(output).slice(0, 12000) });
    }
  }
  return "تعذر إكمال الاستعلام في الوقت المحدد. أعد صياغة السؤال بشكل أقصر.";
}

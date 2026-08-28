import { NextRequest, NextResponse } from "next/server";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { normalizeCopilotMessages, runCopilotConversation } from "@/server/ai/copilot-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const tenant = await getTenantDbFromSession();
    const body = await request.json().catch(() => ({}));
    const messages = normalizeCopilotMessages(body?.messages);
    if (!messages.length || messages.at(-1)?.role !== "user") return NextResponse.json({ error: "أرسل سؤالاً واضحاً للمساعد." }, { status: 400 });
    const reply = await tenant.run(() => runCopilotConversation(tenant, messages));
    return NextResponse.json({ reply }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[copilot] request failed:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "تعذر تجهيز المساعد الذكي للجلسة الحالية. أعد تسجيل الدخول ثم أعد المحاولة." }, { status: 401 });
  }
}

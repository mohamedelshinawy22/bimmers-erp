"use server";

import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { normalizeCopilotMessages, runCopilotConversation, type CopilotInputMessage } from "@/server/ai/copilot-runner";
import { safeCopilotErrorMessage } from "@/server/ai/copilot-error";

export type AskCopilotResult = { success: true; reply: string } | { success: false; error: string };

export async function askCopilotAction(messages: CopilotInputMessage[]): Promise<AskCopilotResult> {
  try {
    const tenant = await getTenantDbFromSession();
    const normalized = normalizeCopilotMessages(messages);
    if (!normalized.length || normalized.at(-1)?.role !== "user") return { success: false, error: "أرسل سؤالاً واضحاً للمساعد." };
    const reply = await tenant.run(() => runCopilotConversation(tenant, normalized));
    return { success: true, reply };
  } catch (error) {
    console.error("[copilot-action] request failed:", error instanceof Error ? error.message : "unknown");
    return { success: false, error: safeCopilotErrorMessage(error) };
  }
}

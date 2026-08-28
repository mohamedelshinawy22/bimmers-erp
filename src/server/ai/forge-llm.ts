import "server-only";

export type ForgeMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ForgeToolCall[];
};

export type ForgeToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ForgeTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ForgeResponse = {
  choices?: Array<{ message?: ForgeMessage; finish_reason?: string }>;
};

function forgeChatUrl() {
  const base = process.env.BUILT_IN_FORGE_API_URL?.replace(/\/$/, "");
  if (!base) throw new Error("خدمة المساعد الذكي غير مهيأة حالياً.");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

export async function invokeLLM(input: {
  messages: ForgeMessage[];
  tools?: ForgeTool[];
  toolChoice?: "auto" | "none";
  maxTokens?: number;
}): Promise<ForgeResponse> {
  const apiKey = process.env.BUILT_IN_FORGE_API_KEY;
  if (!apiKey) throw new Error("خدمة المساعد الذكي غير مهيأة حالياً.");
  const response = await fetch(forgeChatUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: input.messages,
      tools: input.tools,
      tool_choice: input.tools?.length ? input.toolChoice ?? "auto" : undefined,
      max_tokens: input.maxTokens ?? 900,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("تعذر الاتصال بخدمة المساعد الذكي حالياً.");
  return (await response.json()) as ForgeResponse;
}

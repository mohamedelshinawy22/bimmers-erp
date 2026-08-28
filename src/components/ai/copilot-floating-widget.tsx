"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown, Send, Sparkles, X } from "lucide-react";

type ChatMessage = { role: "user" | "assistant"; content: string };

const quickPrompts = ["ملخص مبيعات النهاردة", "إيه النواقص الحرجة؟", "علينا كام للموردين؟", "رصيد وسعر تيل F30"];

export function CopilotFloatingWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: "assistant", content: "أهلاً بك. أنا مساعد Bimmers ERP الذكي. اسألني عن المبيعات أو المخزون أو الفواتير أو الأرصدة، وسأجيبك من بيانات المؤسسة الحالية." }]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function sendMessage(event?: FormEvent, prompt?: string) {
    event?.preventDefault();
    const content = (prompt ?? input).trim();
    if (!content || loading) return;
    const userMessage: ChatMessage = { role: "user", content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/ai/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextMessages }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "تعذر جلب إجابة المساعد حالياً.");
      setMessages((current) => [...current, { role: "assistant", content: data.reply || "لم أجد إجابة لهذا السؤال." }]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "تعذر جلب إجابة المساعد حالياً.");
    } finally { setLoading(false); }
  }

  return <div className="fixed bottom-5 left-5 z-[60]" dir="rtl">
    {!open ? <button type="button" onClick={() => setOpen(true)} aria-label="فتح المساعد الذكي" className="group flex items-center gap-2.5 rounded-full border border-bmw-blue/40 bg-gradient-to-l from-bmw-blue to-indigo-600 px-4 py-3 text-white shadow-2xl shadow-bmw-blue/25 transition hover:-translate-y-0.5 hover:shadow-bmw-blue/40 active:scale-95"><Sparkles size={18} className="text-amber-200" /><span className="text-xs font-bold">المساعد الذكي</span></button> : <section className="flex h-[min(650px,calc(100vh-2rem))] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950/95 shadow-2xl backdrop-blur-xl" aria-label="Bimmers AI Copilot">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-4 py-3"><div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-bmw-blue/30 bg-bmw-blue/15 text-bmw-blue"><Bot size={18} /></span><div><h2 className="text-sm font-bold text-white">Bimmers Copilot</h2><p className="text-[10px] text-slate-400">إجابات من بيانات المؤسسة الحية</p></div></div><button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white" aria-label="إغلاق المساعد"><X size={17} /></button></header>
      <div className="flex gap-1.5 overflow-x-auto border-b border-slate-800/80 bg-slate-950/70 px-3 py-2 [scrollbar-width:none]">{quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => void sendMessage(undefined, prompt)} disabled={loading} className="whitespace-nowrap rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-[10px] text-slate-300 transition hover:border-bmw-blue/50 hover:bg-bmw-blue/15 hover:text-white disabled:opacity-50">{prompt}</button>)}</div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3.5 text-xs">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-start" : "justify-end"}`}><div className={`max-w-[88%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 leading-relaxed ${message.role === "user" ? "rounded-br-md bg-bmw-blue text-white" : "rounded-bl-md border border-slate-700 bg-slate-800/90 text-slate-200"}`}>{message.content}</div></div>)}{loading ? <div className="flex items-center gap-2 text-[11px] text-slate-400"><Bot size={14} className="animate-pulse text-bmw-blue" />جاري قراءة البيانات وتحليل السؤال…</div> : null}{error ? <div className="rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 text-[11px] leading-relaxed text-red-200">{error}</div> : null}<div ref={endRef} /></div>
      <form onSubmit={(event) => void sendMessage(event)} className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/90 p-3"><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="اكتب سؤالك بالمصري أو بالعربية…" aria-label="سؤال المساعد" className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white outline-none transition placeholder:text-slate-500 focus:border-bmw-blue" disabled={loading} /><button type="submit" disabled={loading || !input.trim()} aria-label="إرسال السؤال" className="rounded-xl bg-bmw-blue p-2.5 text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"><Send size={15} /></button></form>
    </section>}
  </div>;
}

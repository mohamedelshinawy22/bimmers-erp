"use client";

import { useEffect } from "react";

export default function AuthenticatedRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[authenticated-route-error]", error); }, [error]);
  return <main className="mx-auto flex min-h-[55vh] max-w-xl items-center justify-center p-6" dir="rtl"><section className="w-full rounded-2xl border border-amber-400/30 bg-amber-400/10 p-6 text-center"><h1 className="text-xl font-bold text-white">تعذر تحميل هذه الصفحة مؤقتاً</h1><p className="mt-3 text-sm leading-6 text-slate-300">لم تتأثر بياناتك. أعد المحاولة، أو ارجع إلى لوحة التحكم إذا استمر الخطأ.</p>{error.digest ? <p className="mt-2 font-mono text-xs text-slate-500">رمز التتبع: {error.digest}</p> : null}<div className="mt-5 flex justify-center gap-3"><button type="button" onClick={reset} className="rounded-lg bg-bmw-blue px-4 py-2 text-sm font-bold text-slate-950">إعادة المحاولة</button><a href="/" className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white">لوحة التحكم</a></div></section></main>;
}

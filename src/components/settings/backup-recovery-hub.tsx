"use client";

import { Component, type ErrorInfo, useRef, useState } from "react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, DatabaseBackup, Download, FileJson2, FolderOpen, KeyRound, RotateCcw, ShieldCheck, Upload } from "lucide-react";

type BackupSummary = { createdAt: string; users: number; parts: number; accounts: number; treasuries: number; invoices: number; transactions: number; stockMovements: number; confirmationPhrase: string };

function safeFormatDate(rawDate?: unknown): string {
  if (!rawDate) return "—";
  try {
    const date = new Date(String(rawDate));
    return Number.isNaN(date.getTime()) ? String(rawDate) : date.toLocaleString("ar-EG");
  } catch {
    return String(rawDate);
  }
}

function extractNumber(source: string, key: string) {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : 0;
}

function inspectBackupHeader(source: string): BackupSummary | null {
  const createdAt = source.match(/"createdAt"\s*:\s*"([^"]+)"/)?.[1];
  const format = source.match(/"format"\s*:\s*"([^"]+)"/)?.[1];
  if (!createdAt || format !== "bimmers-erp.snapshot.v1") return null;
  return { createdAt, users: extractNumber(source, "users"), parts: extractNumber(source, "parts"), accounts: extractNumber(source, "accounts"), treasuries: extractNumber(source, "treasuries"), invoices: extractNumber(source, "invoices"), transactions: extractNumber(source, "treasuryTransactions"), stockMovements: extractNumber(source, "stockMovements"), confirmationPhrase: "استعادة نسخة احتياطية" };
}

class RecoveryErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {}
  render() {
    if (this.state.failed) return <div className="rounded-2xl border border-bmw-mRed/40 bg-bmw-mRed/5 p-4 text-sm text-rose-200" dir="rtl"><b>تعذر عرض مركز الاستعادة بأمان.</b><p className="mt-1 text-xs text-bmw-muted">لم تُنفذ أي عملية على البيانات. حدّث الصفحة ثم أعد المحاولة.</p><button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg border border-rose-400/40 px-3 py-1.5 text-xs font-bold">تحديث الصفحة</button></div>;
    return this.props.children;
  }
}

function RestoreBackupModal({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedFileRef = useRef<File | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState("");
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState<{ status: string; percent: number } | null>(null);
  const phraseMatches = confirmationPhrase === (summary?.confirmationPhrase ?? "استعادة نسخة احتياطية");

  const inspectFile = async (file?: File) => {
    if (!file) return;
    setError(null); setSummary(null); selectedFileRef.current = null; setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".json")) { setError("اختر ملف نسخة احتياطية بصيغة JSON."); return; }
    if (file.size > 50 * 1024 * 1024) { setError("حجم الملف يتجاوز الحد المسموح للاستعادة عبر الويب (50MB)."); return; }
    try {
      // Pre-flight deliberately reads a small header slice only; the full file never enters React state or a server action payload.
      const header = await file.slice(0, Math.min(file.size, 256 * 1024)).text();
      const inspected = inspectBackupHeader(header);
      if (!inspected) { setError("تعذر قراءة تعريف النسخة. اختر ملف BimmerERP JSON صالحاً."); return; }
      selectedFileRef.current = file;
      setSummary(inspected);
      setStep(2);
    } catch {
      setError("تعذر قراءة رأس ملف النسخة الاحتياطية.");
    }
  };

  const restore = async () => {
    const selectedFile = selectedFileRef.current;
    if (!selectedFile) { setError("ملف النسخة الاحتياطية مفقود. أعد اختياره من الخطوة الأولى."); return; }
    if (!phraseMatches || !adminPassword) return;
    const postJson = async <T,>(url: string, body: unknown): Promise<T> => {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const contentType = response.headers.get("content-type") ?? "";
      const payload = (contentType.includes("application/json") ? await response.json().catch(() => ({})) : { error: `استجابة غير متوقعة من الخادم (HTTP ${response.status}): ${(await response.text()).slice(0, 180)}` }) as T & { success?: boolean; error?: string };
      if (!response.ok || !payload.success) throw new Error(payload.error || `فشل الطلب؛ أعاد الخادم HTTP ${response.status}.`);
      return payload;
    };
    const chunkByBytes = (rows: unknown[], maxRows: number, maxBytes: number) => {
      const chunks: unknown[][] = [];
      for (let cursor = 0; cursor < rows.length;) {
        const chunk: unknown[] = [];
        while (cursor < rows.length && chunk.length < maxRows) {
          const candidate = [...chunk, rows[cursor]];
          if (chunk.length && new Blob([JSON.stringify(candidate)]).size > maxBytes) break;
          if (!chunk.length && new Blob([JSON.stringify(candidate)]).size > maxBytes) throw new Error("يوجد سجل واحد أكبر من الحد الآمن لدفعة الاستعادة.");
          chunk.push(rows[cursor++]);
        }
        chunks.push(chunk);
      }
      return chunks;
    };
    setError(null); setRestoring(true); setProgress({ status: "قراءة ملف النسخة الاحتياطية محلياً…", percent: 3 });
    try {
      const snapshot = JSON.parse(await selectedFile.text()) as { metadata?: { createdAt?: string; checksum?: string }; data?: Record<string, unknown[]> };
      if (!snapshot.metadata?.createdAt || !snapshot.metadata?.checksum || !snapshot.data) throw new Error("ملف النسخة غير صالح: بيانات التعريف أو كائن data مفقود.");
      setProgress({ status: "التحقق من كلمة مرور المدير وتهيئة قاعدة البيانات…", percent: 8 });
      const init = await postJson<{ restoreToken: string; actorId: string; maxRows: number; maxBytes: number }>("/api/admin/restore-chunk/init", { adminPassword, confirmationPhrase, metadata: snapshot.metadata });
      const tables = ["users", "userPermissions", "brands", "categories", "chassis", "engines", "warehouseBins", "accounts", "treasuries", "parts", "partChassis", "partEngines", "customerVehicles", "invoices", "invoiceItems", "heldSales", "heldSaleItems", "accountChecks", "installmentPlans", "installments", "treasuryShifts", "treasuryTransfers", "treasuryTransactions", "stockMovements", "accountBalanceAdjustments", "barcodeConfigs", "importJobs", "documentCounters", "systemSettings", "systemAuditTrail"] as const;
      const labels: Record<string, string> = { users: "المستخدمين", userPermissions: "الصلاحيات", brands: "الماركات", categories: "الفئات", chassis: "أكواد الشاسيه", engines: "أكواد المحركات", warehouseBins: "نقاط التخزين", accounts: "الحسابات", treasuries: "الخزائن", parts: "الأصناف", invoices: "الفواتير", invoiceItems: "بنود الفواتير", treasuryTransactions: "حركات الخزينة", stockMovements: "حركات المخزون", systemAuditTrail: "سجل التدقيق" };
      for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
        const table = tables[tableIndex];
        if (!table) continue;
        const rows = Array.isArray(snapshot.data[table]) ? snapshot.data[table] : [];
        const chunks = chunkByBytes(rows, init.maxRows, Math.min(init.maxBytes, 700 * 1024));
        for (let index = 0; index < chunks.length; index++) {
          const percent = Math.round(10 + ((tableIndex + (index + 1) / Math.max(chunks.length, 1)) / tables.length) * 80);
          setProgress({ status: `استعادة ${labels[table] ?? table} — دفعة ${index + 1} من ${chunks.length || 1}`, percent });
          await postJson("/api/admin/restore-chunk/insert", { restoreToken: init.restoreToken, table, rows: chunks[index] });
        }
      }
      const categoryLinks = (snapshot.data.categories ?? []).filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row) && "parentId" in row && (row as Record<string, unknown>).parentId)).map((row) => ({ id: row.id, parentId: row.parentId }));
      for (const links of chunkByBytes(categoryLinks, init.maxRows, Math.min(init.maxBytes, 700 * 1024))) await postJson("/api/admin/restore-chunk/finalize", { action: "category-links", restoreToken: init.restoreToken, rows: links });
      const actorSnapshot = (snapshot.data.users ?? []).find((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row) && (row as Record<string, unknown>).id === init.actorId));
      setProgress({ status: "توثيق الاستعادة وإتمام فحص النظام…", percent: 96 });
      await postJson("/api/admin/restore-chunk/finalize", { action: "complete", restoreToken: init.restoreToken, actorProfile: actorSnapshot ? { allowedTreasuryIds: actorSnapshot.allowedTreasuryIds, allowedWarehouseIds: actorSnapshot.allowedWarehouseIds, transferToTreasuryId: actorSnapshot.transferToTreasuryId } : undefined });
      setProgress({ status: "تمت الاستعادة بنجاح — جاري تحديث النظام…", percent: 100 });
      window.setTimeout(() => window.location.assign("/settings?restore=success"), 1100);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "حدث خطأ غير متوقع أثناء الاستعادة المتدرجة.");
      setRestoring(false); setProgress(null);
    }
  };

  const footer = <><Button variant="ghost" onClick={onClose} disabled={restoring}>إلغاء</Button>{step === 2 ? <Button variant="outline" onClick={() => { selectedFileRef.current = null; setSummary(null); setStep(1); }} disabled={restoring}>تغيير الملف</Button> : null}{step === 2 ? <Button onClick={() => setStep(3)} disabled={!summary || restoring}>متابعة إلى التحقق <KeyRound size={15} /></Button> : null}{step === 3 ? <Button variant="danger" onClick={restore} loading={restoring} disabled={!phraseMatches || !adminPassword || !selectedFileRef.current}><RotateCcw size={15} /> تنفيذ الاستعادة الذرية</Button> : null}</>;

  return <Modal open onClose={restoring ? () => undefined : onClose} title="استعادة النظام من نسخة احتياطية" description={`الخطوة ${step} من 3 — لا يبدأ التعديل في قاعدة البيانات قبل اكتمال الفحص والتأكيد.`} size="lg" footer={footer}><div className="space-y-4" dir="rtl">{progress ? <div className="space-y-2 rounded-xl border border-bmw-blue/40 bg-bmw-blue/5 p-3 text-xs text-bmw-blue"><div className="flex items-center justify-between gap-3 font-bold"><span>{progress.status}</span><span className="font-mono">{progress.percent}%</span></div><div className="h-2 overflow-hidden rounded-full border border-bmw-blue/20 bg-slate-950"><div className="h-full rounded-full bg-bmw-blue transition-all duration-300" style={{ width: `${progress.percent}%` }} /></div></div> : null}{error ? <div className="space-y-1 rounded-xl border border-rose-800/80 bg-rose-950/60 p-3 text-xs text-rose-200"><div className="flex items-center gap-1.5 font-bold text-rose-300"><AlertTriangle size={14} /><span>تعذر استعادة النسخة الاحتياطية</span></div><div className="break-words rounded border border-rose-900/50 bg-rose-950/80 p-2 font-mono text-[11px] text-rose-100/90">{error}</div></div> : null}<div className="grid grid-cols-3 gap-2 text-[11px]"><div className={`rounded-lg border p-2 ${step >= 1 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>1. رفع وفحص</div><div className={`rounded-lg border p-2 ${step >= 2 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>2. معاينة المحتوى</div><div className={`rounded-lg border p-2 ${step >= 3 ? "border-amber-500 bg-amber-500/10 text-amber-300" : "border-bmw-cardBorder text-bmw-muted"}`}>3. تحقق وتنفيذ</div></div>{step === 1 ? <section className="space-y-3"><Alert variant="info">يقرأ الفحص الأولي تعريفاً محدوداً من الملف فقط. يبقى ملف النسخة كاملاً خارج ذاكرة React حتى الإرسال المباشر والاستعادة الآمنة.</Alert><button type="button" onClick={() => inputRef.current?.click()} className="flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-bmw-cardBorder bg-bmw-carbon/50 p-6 transition hover:border-bmw-blue hover:bg-bmw-blue/5"><FolderOpen size={32} className="text-bmw-blue" /><span className="text-sm font-bold text-white">اختيار ملف نسخة احتياطية JSON</span><span className="text-xs text-bmw-muted">بحد أقصى 50MB عبر مسار رفع مستقل</span><input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { void inspectFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></button></section> : null}{step === 2 && summary ? <section className="space-y-3"><Alert variant="success">تمت قراءة تعريف الملف <b>{fileName}</b> بأمان. سيجري التحقق الكامل من البصمة وهيكل البيانات على الخادم قبل بدء الاستعادة.</Alert><div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/5 p-3"><p className="mb-2 flex items-center gap-2 text-sm font-bold text-bmw-blue"><FileJson2 size={17} /> ملخص محتويات النسخة</p><div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3"><span>تاريخ النسخة: {safeFormatDate(summary.createdAt)}</span><span>الأصناف: {summary.parts.toLocaleString("ar-EG")}</span><span>الفواتير: {summary.invoices.toLocaleString("ar-EG")}</span><span>الحسابات: {summary.accounts.toLocaleString("ar-EG")}</span><span>الخزائن: {summary.treasuries.toLocaleString("ar-EG")}</span><span>السندات: {summary.transactions.toLocaleString("ar-EG")}</span><span>حركات المخزون: {summary.stockMovements.toLocaleString("ar-EG")}</span><span>المستخدمون: {summary.users.toLocaleString("ar-EG")}</span></div></div><Alert variant="warning">عند التنفيذ سيستبدل النظام البيانات التشغيلية الحالية بالكامل ببيانات هذه النسخة. يبقى حساب المدير المسجل حالياً فعالاً لضمان استمرار الوصول بعد الاستعادة.</Alert></section> : null}{step === 3 && summary ? <section className="space-y-3"><div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-100"><p className="mb-1 flex items-center gap-2 font-bold"><AlertTriangle size={16} />تأكيد نهائي</p><p>هذه عملية دائمة. تأكد من أن لديك نسخة احتياطية حديثة من الحالة الحالية قبل الاستبدال.</p></div><Field label="اكتب عبارة التأكيد"><Input value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} placeholder={summary.confirmationPhrase} autoFocus /></Field><Field label="كلمة مرور مدير النظام الحالية"><Input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="كلمة المرور" dir="ltr" className="text-left font-mono" /></Field>{confirmationPhrase && !phraseMatches ? <p className="text-xs text-bmw-mRed">عبارة التأكيد غير مطابقة.</p> : null}<Alert variant="info">تتحقق كلمة المرور على الخادم باستخدام bcrypt ولا تُحفظ ضمن النسخة أو سجل التدقيق.</Alert></section> : null}</div></Modal>;
}

function BackupRecoveryPanel() {
  const [restoreOpen, setRestoreOpen] = useState(false);
  return <><div className="flex flex-col justify-between gap-4 rounded-2xl border border-bmw-blue/30 bg-slate-900/80 p-5 sm:flex-row sm:items-center"><div><h3 className="flex items-center gap-2 text-sm font-bold text-slate-100"><DatabaseBackup size={19} className="text-bmw-blue" /> إدارة النسخ الاحتياطي واستعادة النظام</h3><p className="mt-1 text-xs text-bmw-muted">نزّل لقطة JSON كاملة وموقعة ببصمة سلامة، أو افحص نسخة سابقة ثم استعدها في معاملة ذرّية محمية.</p></div><div className="flex flex-wrap gap-2"><a href="/api/system/backup" className="inline-flex items-center gap-2 rounded-xl bg-bmw-blue px-4 py-2.5 text-xs font-bold text-white shadow-md transition hover:bg-blue-500"><Download size={15} /> تحميل نسخة احتياطية الآن</a><Button variant="outline" onClick={() => setRestoreOpen(true)}><Upload size={15} /> استرجاع نسخة احتياطية</Button></div></div><div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100"><ShieldCheck size={16} className="mt-0.5 shrink-0" /><p>تحتوي النسخة الكاملة على بيانات تشغيلية حساسة وحسابات المستخدمين. احفظ الملف في موقع مشفر وآمن، ولا تشاركه عبر البريد أو التطبيقات غير الموثوقة.</p></div>{restoreOpen ? <RestoreBackupModal onClose={() => setRestoreOpen(false)} /> : null}</>;
}

export function BackupRecoveryHub() {
  return <RecoveryErrorBoundary><BackupRecoveryPanel /></RecoveryErrorBoundary>;
}

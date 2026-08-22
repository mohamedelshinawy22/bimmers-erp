"use client";

import { useRef, useState, useTransition } from "react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { inspectFullSystemBackupAction, restoreFullSystemBackupAction } from "@/server/actions/backup-restore.actions";
import { AlertTriangle, CheckCircle2, DatabaseBackup, Download, FileJson2, FolderOpen, KeyRound, RotateCcw, ShieldCheck, Upload } from "lucide-react";

type BackupSummary = { createdAt: string; users: number; parts: number; accounts: number; treasuries: number; invoices: number; transactions: number; stockMovements: number; maxBytes: number; confirmationPhrase: string };

function RestoreBackupModal({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState("");
  const [backupJson, setBackupJson] = useState("");
  const [summary, setSummary] = useState<BackupSummary | null>(null);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const phraseMatches = confirmationPhrase === (summary?.confirmationPhrase ?? "استعادة نسخة احتياطية");

  const inspectFile = (file?: File) => {
    if (!file) return;
    setError(null); setSummary(null); setBackupJson(""); setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".json")) { setError("اختر ملف نسخة احتياطية بصيغة JSON."); return; }
    if (file.size > 20 * 1024 * 1024) { setError("حجم الملف يتجاوز الحد الآمن للاستعادة عبر الويب (20MB)."); return; }
    const reader = new FileReader();
    reader.onerror = () => setError("تعذر قراءة ملف النسخة الاحتياطية.");
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      try { JSON.parse(text); } catch { setError("الملف ليس JSON صالحاً."); return; }
      startTransition(async () => {
        const result = await inspectFullSystemBackupAction({ backupJson: text });
        if (!result.success) { setError(result.error); return; }
        setBackupJson(text); setSummary(result.data); setStep(2);
      });
    };
    reader.readAsText(file, "utf-8");
  };

  const restore = () => startTransition(async () => {
    setError(null);
    const result = await restoreFullSystemBackupAction({ backupJson, confirmationPhrase, adminPassword });
    if (!result.success) { setError(result.error); return; }
    window.location.assign("/");
  });

  const footer = <><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button>{step === 2 ? <Button variant="outline" onClick={() => setStep(1)} disabled={pending}>تغيير الملف</Button> : null}{step === 2 ? <Button onClick={() => setStep(3)} disabled={!summary || pending}>متابعة إلى التحقق <KeyRound size={15} /></Button> : null}{step === 3 ? <Button variant="danger" onClick={restore} loading={pending} disabled={!phraseMatches || !adminPassword || !backupJson}><RotateCcw size={15} /> تنفيذ الاستعادة الذرية</Button> : null}</>;

  return <Modal open onClose={pending ? () => undefined : onClose} title="استعادة النظام من نسخة احتياطية" description={`الخطوة ${step} من 3 — لا يبدأ التعديل في قاعدة البيانات قبل اكتمال الفحص والتأكيد.`} size="lg" footer={footer}><div className="space-y-4" dir="rtl">{error ? <Alert variant="error">{error}</Alert> : null}<div className="grid grid-cols-3 gap-2 text-[11px]"><div className={`rounded-lg border p-2 ${step >= 1 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>1. رفع وفحص</div><div className={`rounded-lg border p-2 ${step >= 2 ? "border-bmw-blue bg-bmw-blue/10 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted"}`}>2. معاينة المحتوى</div><div className={`rounded-lg border p-2 ${step >= 3 ? "border-amber-500 bg-amber-500/10 text-amber-300" : "border-bmw-cardBorder text-bmw-muted"}`}>3. تحقق وتنفيذ</div></div>{step === 1 ? <section className="space-y-3"><Alert variant="info">اختر ملف النسخة الاحتياطية الذي تم تنزيله من BimmerERP. يُفحص تنسيق الإصدار والبصمة الرقمية قبل عرض أي ملخص أو السماح بالاستعادة.</Alert><button type="button" onClick={() => inputRef.current?.click()} className="flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-bmw-cardBorder bg-bmw-carbon/50 p-6 transition hover:border-bmw-blue hover:bg-bmw-blue/5"><FolderOpen size={32} className="text-bmw-blue" /><span className="text-sm font-bold text-white">اختيار ملف نسخة احتياطية JSON</span><span className="text-xs text-bmw-muted">بحد أقصى 20MB للاستعادة الآمنة عبر الويب</span><input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { inspectFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></button></section> : null}{step === 2 && summary ? <section className="space-y-3"><Alert variant="success">تم التحقق من سلامة الملف <b>{fileName}</b> وبصمته الرقمية بنجاح.</Alert><div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/5 p-3"><p className="mb-2 flex items-center gap-2 text-sm font-bold text-bmw-blue"><FileJson2 size={17} /> ملخص محتويات النسخة</p><div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3"><span>تاريخ النسخة: {new Date(summary.createdAt).toLocaleString("ar-EG")}</span><span>الأصناف: {summary.parts.toLocaleString("ar-EG")}</span><span>الفواتير: {summary.invoices.toLocaleString("ar-EG")}</span><span>الحسابات: {summary.accounts.toLocaleString("ar-EG")}</span><span>الخزائن: {summary.treasuries.toLocaleString("ar-EG")}</span><span>السندات: {summary.transactions.toLocaleString("ar-EG")}</span><span>حركات المخزون: {summary.stockMovements.toLocaleString("ar-EG")}</span><span>المستخدمون: {summary.users.toLocaleString("ar-EG")}</span></div></div><Alert variant="warning">عند التنفيذ سيستبدل النظام البيانات التشغيلية الحالية بالكامل ببيانات هذه النسخة. يبقى حساب المدير المسجل حالياً فعالاً لضمان استمرار الوصول بعد الاستعادة.</Alert></section> : null}{step === 3 && summary ? <section className="space-y-3"><div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-100"><p className="mb-1 flex items-center gap-2 font-bold"><AlertTriangle size={16} />تأكيد نهائي</p><p>هذه عملية دائمة. تأكد من أن لديك نسخة احتياطية حديثة من الحالة الحالية قبل الاستبدال.</p></div><Field label="اكتب عبارة التأكيد"><Input value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} placeholder={summary.confirmationPhrase} autoFocus /></Field><Field label="كلمة مرور مدير النظام الحالية"><Input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="كلمة المرور" dir="ltr" className="text-left font-mono" /></Field>{confirmationPhrase && !phraseMatches ? <p className="text-xs text-bmw-mRed">عبارة التأكيد غير مطابقة.</p> : null}<Alert variant="info">تتحقق كلمة المرور على الخادم باستخدام bcrypt ولا تُحفظ ضمن النسخة أو سجل التدقيق.</Alert></section> : null}</div></Modal>;
}

export function BackupRecoveryHub() {
  const [restoreOpen, setRestoreOpen] = useState(false);
  return <><div className="flex flex-col justify-between gap-4 rounded-2xl border border-bmw-blue/30 bg-slate-900/80 p-5 sm:flex-row sm:items-center"><div><h3 className="flex items-center gap-2 text-sm font-bold text-slate-100"><DatabaseBackup size={19} className="text-bmw-blue" /> إدارة النسخ الاحتياطي واستعادة النظام</h3><p className="mt-1 text-xs text-bmw-muted">نزّل لقطة JSON كاملة وموقعة ببصمة سلامة، أو افحص نسخة سابقة ثم استعدها في معاملة ذرّية محمية.</p></div><div className="flex flex-wrap gap-2"><a href="/api/system/backup" className="inline-flex items-center gap-2 rounded-xl bg-bmw-blue px-4 py-2.5 text-xs font-bold text-white shadow-md transition hover:bg-blue-500"><Download size={15} /> تحميل نسخة احتياطية الآن</a><Button variant="outline" onClick={() => setRestoreOpen(true)}><Upload size={15} /> استرجاع نسخة احتياطية</Button></div></div><div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-100"><ShieldCheck size={16} className="mt-0.5 shrink-0" /><p>تحتوي النسخة الكاملة على بيانات تشغيلية حساسة وحسابات المستخدمين. احفظ الملف في موقع مشفر وآمن، ولا تشاركه عبر البريد أو التطبيقات غير الموثوقة.</p></div>{restoreOpen ? <RestoreBackupModal onClose={() => setRestoreOpen(false)} /> : null}</>;
}

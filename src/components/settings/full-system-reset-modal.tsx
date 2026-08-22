"use client";

import { useState, useTransition } from "react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, DatabaseZap, LockKeyhole, ShieldAlert } from "lucide-react";
import { purgeAllSystemDataAction } from "@/server/actions/system-reset.actions";

const CONFIRMATION_PHRASE = "مسح شامل وتصفير النظام";

interface FullSystemResetModalProps {
  onClose: () => void;
}

export function FullSystemResetModal({ onClose }: FullSystemResetModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [confirmationPhrase, setConfirmationPhrase] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const phraseConfirmed = confirmationPhrase === CONFIRMATION_PHRASE;

  const execute = () => startTransition(async () => {
    setError(null);
    const result = await purgeAllSystemDataAction({ confirmationPhrase, adminPassword });
    if (!result.success) { setError(result.error); return; }
    window.location.assign("/");
  });

  const footer = step === 1 ? <><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="danger" onClick={() => setStep(2)}>راجعت المخاطر، متابعة <ArrowLeft size={15} /></Button></> : step === 2 ? <><Button variant="ghost" onClick={() => setStep(1)}><ArrowRight size={15} /> رجوع</Button><Button variant="danger" disabled={!phraseConfirmed} onClick={() => setStep(3)}>تأكيد العبارة والمتابعة <ArrowLeft size={15} /></Button></> : <><Button variant="ghost" onClick={() => setStep(2)} disabled={pending}><ArrowRight size={15} /> رجوع</Button><Button variant="danger" disabled={!phraseConfirmed || !adminPassword || pending} loading={pending} onClick={execute}><DatabaseZap size={15} /> تأكيد وتنفيذ المسح الشامل</Button></>;

  return <Modal open onClose={pending ? () => undefined : onClose} title="إعادة ضبط المصنع وتصفير النظام" description={`الخطوة ${step} من 3 — هذه العملية دائمة ولا يمكن عكسها من واجهة النظام.`} size="lg" footer={footer}><div className="space-y-4" dir="rtl">{error ? <Alert variant="error">{error}</Alert> : null}<div className="flex items-center gap-2 rounded-xl border border-bmw-mRed/40 bg-bmw-mRed/10 p-3 text-sm font-bold text-rose-200"><ShieldAlert size={19} /><span>تنبيه بالغ الأهمية: لا تنفذ هذا الإجراء إلا بعد التأكد من وجود نسخة احتياطية مستقلة.</span></div>{step === 1 ? <><div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon/60 p-4"><div className="mb-3 flex items-center gap-2 text-bmw-silver"><AlertTriangle size={18} className="text-amber-400" /><p className="font-bold">البيانات التي ستُزال نهائياً</p></div><div className="grid gap-2 text-xs text-bmw-muted sm:grid-cols-2">{["فواتير البيع والشراء والمرتجعات وبنودها", "سندات القبض والصرف والتحويلات والورديات", "حركات المخزون، كتالوج الأصناف، الماركات، والتصنيفات", "حسابات العملاء والورش والموردين والأرصدة", "الشيكات والأقساط والمبيعات المعلقة وملفات الاستيراد", "إعدادات الباركود، العدادات، وسجل التدقيق السابق"].map((item) => <p key={item} className="flex gap-2"><span className="text-bmw-mRed">•</span>{item}</p>)}</div></div><div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs text-emerald-200"><p className="mb-2 flex items-center gap-2 font-bold"><CheckCircle2 size={16} />ما سيبقى وما سيُعاد إنشاؤه</p><p>تبقى حسابات المستخدمين وكلمات مرورهم وصلاحياتهم، ثم يعيد النظام إنشاء المخزن الرئيسي، الخزينة الرئيسية، درج النقدية، العميل النقدي الافتراضي، وإعدادات تشغيل أساسية نظيفة.</p></div></> : null}{step === 2 ? <div className="space-y-3 rounded-xl border border-bmw-cardBorder bg-bmw-carbon/60 p-4"><p className="text-sm font-bold text-white">تأكيد العبارة الدائمة</p><p className="text-xs leading-6 text-bmw-muted">اكتب العبارة التالية حرفياً لتأكيد أنك تدرك أن العملية ستزيل جميع البيانات التشغيلية:</p><p dir="rtl" className="select-all rounded-lg border border-bmw-mRed/30 bg-bmw-black/40 px-3 py-2 text-center font-bold text-rose-300">{CONFIRMATION_PHRASE}</p><Input value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} placeholder={CONFIRMATION_PHRASE} aria-label="عبارة تأكيد مسح النظام" className="text-center" autoFocus />{confirmationPhrase && !phraseConfirmed ? <p className="text-xs text-bmw-mRed">عبارة التأكيد غير مطابقة.</p> : null}</div> : null}{step === 3 ? <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><div className="flex items-center gap-2 text-amber-200"><LockKeyhole size={18} /><p className="text-sm font-bold">تحقق نهائي من كلمة مرور مدير النظام</p></div><p className="text-xs leading-6 text-bmw-muted">أدخل كلمة مرور المستخدم المسجل حالياً. تتحقق كلمة المرور على الخادم ولا تُحفظ أو تُسجل في أي سجل تدقيق.</p><Input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} placeholder="كلمة المرور الحالية" aria-label="كلمة مرور مدير النظام" dir="ltr" className="text-left font-mono" autoFocus /><Alert variant="warning">بعد الضغط على «تأكيد وتنفيذ المسح الشامل» ستبدأ العملية فوراً. لا تغلق الصفحة حتى يعود النظام إلى لوحة التحكم.</Alert></div> : null}</div></Modal>;
}

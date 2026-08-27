"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Flame, ImagePlus, Printer, Save, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/modal";
import { UsersPanel } from "./users-panel";
import { FullSystemResetModal } from "@/components/settings/full-system-reset-modal";
import { BackupRecoveryHub } from "@/components/settings/backup-recovery-hub";
import { LicenseSubscriptionCard } from "@/components/settings/license-subscription-card";
import type { ManagedUser } from "@/server/services/audit.service";
import type { CompanyProfile } from "@/server/services/settings.service";
import type { SubscriptionDetails } from "@/lib/license-subscription";
import { updateCompanySettingsAction, updateSettingsAction } from "@/server/actions/settings.actions";
import {
  BOOLEAN_SETTING_KEYS as BOOLEAN_KEYS,
  HIDDEN_SETTING_KEYS as HIDDEN_KEYS,
  NUMERIC_SETTING_KEYS as NUMERIC_KEYS,
  SETTING_GROUP_LABELS as GROUP_LABELS,
} from "@/lib/settings-keys";

interface SettingItem {
  key: string;
  label: string;
  value: string;
}

interface SettingsFormProps {
  groups: Array<{ group: string; items: SettingItem[] }>;
  canWrite: boolean;
  canFactoryReset: boolean;
  users: ManagedUser[] | null;
  currentUserId: string;
  companyProfile: CompanyProfile;
  subscription: SubscriptionDetails;
  tenantQuota: { maxSubUsers: number; activeSubUsers: number } | null;
  treasuries: Array<{ id: string; name: string; type: string }>;
  warehouses: string[];
}

// Key classification is imported, not redeclared: the server validates against
// the same sets, and a divergence would let a boolean be stored as free text
// (which `getSetting(...) === "true"` silently reads as false).

const PROFILE_KEYS = new Set(["COMPANY_NAME", "COMMERCIAL_NAME", "COMPANY_PHONE", "COMPANY_PHONE_SECONDARY", "COMPANY_ADDRESS", "TAX_NUMBER", "COMMERCIAL_REGISTER", "COMPANY_LOGO_URL", "INVOICE_FOOTER"]);

export function SettingsForm({ groups, canWrite, canFactoryReset, users, currentUserId, companyProfile, subscription, tenantQuota, treasuries, warehouses }: SettingsFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [factoryResetOpen, setFactoryResetOpen] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.key, i.value]))),
  );
  const [savedValues, setSavedValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.key, i.value]))),
  );
  const initialProfile = {
    companyName: companyProfile.name,
    commercialName: companyProfile.commercialName,
    taxNumber: companyProfile.taxNumber,
    commercialRegister: companyProfile.commercialRegister,
    address: companyProfile.address,
    phonePrimary: companyProfile.phonePrimary,
    phoneSecondary: companyProfile.phoneSecondary,
    logoUrl: companyProfile.logoUrl,
    footerNote: companyProfile.invoiceFooter,
  };
  const [profile, setProfile] = useState(initialProfile);
  const [savedProfile, setSavedProfile] = useState(initialProfile);

  const dirty = groups
    .flatMap((g) => g.items)
    .filter((item) => !HIDDEN_KEYS.has(item.key) && values[item.key] !== savedValues[item.key]);
  const profileDirtyCount = (Object.keys(profile) as Array<keyof typeof profile>).filter((key) => profile[key] !== savedProfile[key]).length;
  const totalDirtyCount = dirty.length + profileDirtyCount;
  const updateProfileField = <K extends keyof typeof profile>(key: K, value: typeof profile[K]) => setProfile((current) => ({ ...current, [key]: value }));

  const saveLogo = (logoUrl: string) => {
    updateProfileField("logoUrl", logoUrl);
    setError(null);
    setSuccess(logoUrl ? "تم تحديث معاينة الشعار. اضغط حفظ التعديلات لتثبيت التغيير." : "تمت إزالة الشعار من المعاينة. اضغط حفظ التعديلات لتثبيت التغيير.");
  };

  const handleLogoFile = (file?: File) => {
    if (!file) return;
    const allowed = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    if (!allowed.includes(file.type)) { setError("يرجى اختيار صورة PNG أو JPG أو SVG أو WebP فقط."); return; }
    if (file.size > 2 * 1024 * 1024) { setError("حجم الشعار يجب ألا يتجاوز 2MB."); return; }
    const reader = new FileReader();
    reader.onerror = () => setError("تعذر قراءة ملف الشعار. حاول استخدام صورة أخرى.");
    reader.onload = () => { const dataUrl = typeof reader.result === "string" ? reader.result : ""; if (dataUrl) saveLogo(dataUrl); };
    reader.readAsDataURL(file);
  };

  const submit = () => {
    if (totalDirtyCount === 0) { setSuccess("لا توجد تعديلات جديدة للحفظ."); return; }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      let updated = 0;
      if (profileDirtyCount > 0) {
        const profileResult = await updateCompanySettingsAction(profile);
        if (!profileResult.success) { setError(profileResult.error); return; }
        updated += profileResult.data.updated;
        setSavedProfile(profile);
      }
      if (dirty.length > 0) {
        const settingsResult = await updateSettingsAction({ entries: dirty.map((item) => ({ key: item.key, value: values[item.key] ?? "" })) });
        if (!settingsResult.success) { setError(settingsResult.error); return; }
        updated += settingsResult.data.updated;
        setSavedValues(values);
      }
      setSuccess(updated ? `تم حفظ ${updated} تعديل بنجاح، وتم تحديث هوية المنشأة في النظام.` : "البيانات محفوظة بالفعل.");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue">
            <SlidersHorizontal size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">إعدادات النظام</h1>
            <p className="text-xs text-bmw-muted">
              كل تعديل يُسجَّل في سجل التدقيق مع اسم المستخدم والوقت
            </p>
          </div>
        </div>
        {canWrite ? (
          <Button onClick={submit} loading={pending} disabled={totalDirtyCount === 0}>
            <Save size={16} /> حفظ التعديلات ({totalDirtyCount})
          </Button>
        ) : null}
      </div>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}
      {!canWrite ? (
        <Alert variant="warning">لديك صلاحية العرض فقط. تعديل الإعدادات متاح لمدير النظام.</Alert>
      ) : null}

      <Card className="border-bmw-blue/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 size={18} className="text-bmw-blue" /> بيانات المنشأة والطباعة</CardTitle>
          <p className="text-xs text-bmw-muted">تظهر هذه البيانات تلقائياً في جميع فواتير البيع والشراء، الإيصالات الحرارية، الفاتورة الإلكترونية، والـ QR.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="اسم الشركة / المنشأة" required><Input value={profile.companyName} disabled={!canWrite} onChange={(event) => updateProfileField("companyName", event.target.value)} /></Field>
            <Field label="الاسم التجاري / النشاط"><Input value={profile.commercialName} disabled={!canWrite} onChange={(event) => updateProfileField("commercialName", event.target.value)} placeholder="مثال: الشافعي لقطع غيار BMW" /></Field>
            <Field label="رقم التسجيل الضريبي"><Input value={profile.taxNumber} disabled={!canWrite} onChange={(event) => updateProfileField("taxNumber", event.target.value)} dir="ltr" className="text-left" /></Field>
            <Field label="السجل التجاري"><Input value={profile.commercialRegister} disabled={!canWrite} onChange={(event) => updateProfileField("commercialRegister", event.target.value)} dir="ltr" className="text-left" /></Field>
            <Field label="الهاتف الرئيسي"><Input value={profile.phonePrimary} disabled={!canWrite} onChange={(event) => updateProfileField("phonePrimary", event.target.value)} dir="ltr" className="text-left" /></Field>
            <Field label="الهاتف الثانوي"><Input value={profile.phoneSecondary} disabled={!canWrite} onChange={(event) => updateProfileField("phoneSecondary", event.target.value)} dir="ltr" className="text-left" /></Field>
            <Field label="العنوان الرئيسي / الفروع" className="sm:col-span-2"><Textarea rows={2} value={profile.address} disabled={!canWrite} onChange={(event) => updateProfileField("address", event.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="شعار المنشأة" hint="PNG / JPG / SVG / WebP حتى 2MB — يظهر في الطباعة والنظام"><input ref={logoInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(event) => { handleLogoFile(event.target.files?.[0]); event.currentTarget.value = ""; }} disabled={!canWrite} /><div onDragOver={(event) => { if (canWrite) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (canWrite) handleLogoFile(event.dataTransfer.files?.[0]); }} onClick={() => canWrite && logoInputRef.current?.click()} className={`mt-1 flex min-h-32 cursor-pointer items-center justify-between gap-4 rounded-xl border border-dashed p-4 transition-colors ${canWrite ? "border-bmw-blue/50 bg-bmw-blue/5 hover:bg-bmw-blue/10" : "border-bmw-cardBorder bg-bmw-carbon/40"}`}><div className="flex items-center gap-3">{profile.logoUrl ? <img src={profile.logoUrl} alt="معاينة شعار المنشأة" className="h-20 w-28 rounded-lg border border-bmw-cardBorder bg-white object-contain p-1" /> : <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-bmw-cardBorder bg-bmw-carbon text-bmw-muted"><ImagePlus size={28} /></div>}<div><p className="font-bold text-white">{profile.logoUrl ? "معاينة الشعار الحالي" : "ارفع شعار المنشأة"}</p><p className="mt-1 text-xs text-bmw-muted">اسحب الصورة هنا أو انقر للاختيار، ثم اضغط حفظ التعديلات لتثبيت التغيير بشكل آمن.</p>{profile.logoUrl ? <p className="mt-1 text-[10px] text-emerald-400">سيظهر في الفواتير وكشوف الحسابات والواجهة الرئيسية.</p> : null}</div></div>{canWrite && profile.logoUrl ? <Button type="button" variant="danger" size="sm" onClick={(event) => { event.stopPropagation(); saveLogo(""); }} disabled={pending}><Trash2 size={14} />إزالة</Button> : canWrite ? <span className="rounded-lg border border-bmw-blue/30 px-3 py-2 text-xs text-bmw-blue"><Upload size={14} className="ml-1 inline" />اختيار ملف</span> : null}</div></Field></div><Field label="رابط الشعار" hint="اختياري — يمكنك أيضاً لصق رابط صورة آمن"><Input value={profile.logoUrl} disabled={!canWrite} onChange={(event) => updateProfileField("logoUrl", event.target.value)} placeholder="https://…" dir="ltr" className="text-left" /></Field>
            <Field label="رسالة التذييل / شروط الضمان" className="sm:col-span-2"><Textarea rows={3} value={profile.footerNote} disabled={!canWrite} onChange={(event) => updateProfileField("footerNote", event.target.value)} placeholder="شكراً لتعاملكم معنا" /></Field>
          </div>
          {canWrite ? <Button onClick={submit} loading={pending} disabled={totalDirtyCount === 0}><Printer size={16} /> حفظ بيانات المنشأة ({profileDirtyCount})</Button> : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {groups.map((group) => {
          const visible = group.items.filter((i) => !HIDDEN_KEYS.has(i.key) && !PROFILE_KEYS.has(i.key));
          if (visible.length === 0) return null;
          return (
            <Card key={group.group}>
              <CardHeader>
                <CardTitle>{GROUP_LABELS[group.group] ?? group.group}</CardTitle>
                <span className="font-mono text-[10px] text-bmw-muted">{group.group}</span>
              </CardHeader>
              <CardContent className="space-y-3">
                {visible.map((item) => (
                  <Field key={item.key} label={item.label} hint={item.key}>
                    {BOOLEAN_KEYS.has(item.key) ? (
                      <Select
                        value={values[item.key] ?? "false"}
                        disabled={!canWrite}
                        onChange={(e) => setValues((v) => ({ ...v, [item.key]: e.target.value }))}
                      >
                        <option value="true">مُفعّل</option>
                        <option value="false">مُعطّل</option>
                      </Select>
                    ) : (
                      <Input
                        type={NUMERIC_KEYS.has(item.key) ? "number" : "text"}
                        min={NUMERIC_KEYS.has(item.key) ? 0 : undefined}
                        max={NUMERIC_KEYS.has(item.key) ? 100 : undefined}
                        step={NUMERIC_KEYS.has(item.key) ? "0.01" : undefined}
                        value={values[item.key] ?? ""}
                        disabled={!canWrite}
                        onChange={(e) => setValues((v) => ({ ...v, [item.key]: e.target.value }))}
                      />
                    )}
                  </Field>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {users ? <UsersPanel users={users} currentUserId={currentUserId} tenantQuota={tenantQuota} treasuries={treasuries} warehouses={warehouses} /> : null}

      {canFactoryReset ? <BackupRecoveryHub /> : null}

      {canFactoryReset ? <Card className="border-2 border-bmw-mRed/50 bg-bmw-mRed/5"><CardHeader><CardTitle className="text-rose-300"><Flame size={18} /> منطقة الخطر: إعادة ضبط المصنع وتصفير النظام</CardTitle><p className="text-xs text-bmw-muted">يحذف هذا الإجراء جميع البيانات التشغيلية نهائياً، ثم ينشئ خط أساس نظيفاً. لا يمكن تنفيذه إلا من حساب مدير النظام وبعد إدخال عبارة التأكيد وكلمة المرور الحالية.</p></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-rose-200">تتضمن العملية الفواتير والسندات والأرصدة والأصناف والمخزون والحركات والسجل التدقيقي السابق.</div><Button variant="danger" onClick={() => setFactoryResetOpen(true)}><Flame size={16} /> مسح وتصفير كافة البيانات</Button></CardContent></Card> : null}

      <LicenseSubscriptionCard subscription={subscription} />
      {factoryResetOpen ? <FullSystemResetModal onClose={() => setFactoryResetOpen(false)} /> : null}
    </div>
  );
}

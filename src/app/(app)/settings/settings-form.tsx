"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Printer, Save, SlidersHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/modal";
import { UsersPanel } from "./users-panel";
import type { ManagedUser } from "@/server/services/audit.service";
import type { CompanyProfile } from "@/server/services/settings.service";
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
  users: ManagedUser[] | null;
  currentUserId: string;
  companyProfile: CompanyProfile;
}

// Key classification is imported, not redeclared: the server validates against
// the same sets, and a divergence would let a boolean be stored as free text
// (which `getSetting(...) === "true"` silently reads as false).

const PROFILE_KEYS = new Set(["COMPANY_NAME", "COMMERCIAL_NAME", "COMPANY_PHONE", "COMPANY_PHONE_SECONDARY", "COMPANY_ADDRESS", "TAX_NUMBER", "COMMERCIAL_REGISTER", "COMPANY_LOGO_URL", "INVOICE_FOOTER"]);

export function SettingsForm({ groups, canWrite, users, currentUserId, companyProfile }: SettingsFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.flatMap((g) => g.items.map((i) => [i.key, i.value]))),
  );
  const [profile, setProfile] = useState({
    companyName: companyProfile.name,
    commercialName: companyProfile.commercialName,
    taxNumber: companyProfile.taxNumber,
    commercialRegister: companyProfile.commercialRegister,
    address: companyProfile.address,
    phonePrimary: companyProfile.phonePrimary,
    phoneSecondary: companyProfile.phoneSecondary,
    logoUrl: companyProfile.logoUrl,
    footerNote: companyProfile.invoiceFooter,
  });

  const dirty = groups
    .flatMap((g) => g.items)
    .filter((item) => !HIDDEN_KEYS.has(item.key) && values[item.key] !== item.value);

  const saveProfile = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await updateCompanySettingsAction(profile);
      if (!result.success) { setError(result.error); return; }
      setSuccess(result.data.updated ? "تم حفظ بيانات المنشأة والطباعة بنجاح." : "بيانات المنشأة محفوظة بالفعل.");
      router.refresh();
    });
  };

  const submit = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await updateSettingsAction({
        entries: dirty.map((item) => ({ key: item.key, value: values[item.key] ?? "" })),
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess(`تم حفظ ${result.data.updated} إعداد بنجاح.`);
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
          <Button onClick={submit} loading={pending} disabled={dirty.length === 0}>
            <Save size={16} /> حفظ التعديلات ({dirty.length})
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
            <Field label="اسم الشركة / المنشأة" required><Input value={profile.companyName} disabled={!canWrite} onChange={(event) => setProfile((current) => ({ ...current, companyName: event.target.value }))} /></Field>
            <Field label="الاسم التجاري / النشاط"><Input value={profile.commercialName} disabled={!canWrite} onChange={(event) => setProfile((current) => ({ ...current, commercialName: event.target.value }))} placeholder="مثال: الشافعي لقطع غيار BMW" /></Field>
            <Field label="رقم التسجيل الضريبي"><Input value={profile.taxNumber} disabled={!canWrite} onChange={(event) => setProfile((current) => ({ ...current, taxNumber: event.target.value }))} dir="ltr" className="text-left" /></Field>
            <Field label="السجل التجاري"><Input value={profile.commercialRegister} disabled={!canWrite} onChange={(event) => setProfile((current) => ({ ...current, commercialRegister: event.target.value }))} dir="ltr" className="text-left" /></Field>
            <Field label="الهاتف الرئيسي"><Input value={profile.phonePrimary} disabled={!canWrite} onChange={(event) => setProfile((current) => ({ ...current, phonePrimary: event.target.value }))} dir="ltr" className="text-left" /></Field>
            <Field label="الهاتف الثانوي"><Input value={profile.phoneSecondary} disabled={!canWrite} onChange={(event) => setProfile((current) => ({ ...current, phoneSecondary: event.target.value }))} dir="ltr" className="text-left" /></Field>
            <Field label="العنوان الرئيسي / الفروع" className="sm:col-span-2"><Textarea rows={2} value={profile.address} disabled={!canWrite} onChange={(event) => setProfile((current) => ({ ...current, address: event.target.value }))} /></Field>
            <Field label="رابط الشعار" hint="اختياري — يستخدم في رأس الفاتورة"><Input value={profile.logoUrl} disabled={!canWrite} onChange={(event) => setProfile((current) => ({ ...current, logoUrl: event.target.value }))} placeholder="https://…" dir="ltr" className="text-left" /></Field>
            <Field label="رسالة التذييل / شروط الضمان" className="sm:col-span-2"><Textarea rows={3} value={profile.footerNote} disabled={!canWrite} onChange={(event) => setProfile((current) => ({ ...current, footerNote: event.target.value }))} placeholder="شكراً لتعاملكم معنا" /></Field>
          </div>
          {canWrite ? <Button onClick={saveProfile} loading={pending}><Printer size={16} /> حفظ بيانات المنشأة</Button> : null}
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

      {users ? <UsersPanel users={users} currentUserId={currentUserId} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>معلومات البنية التحتية</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 gap-2 font-mono text-[11px] text-bmw-muted sm:grid-cols-2">
            <li>• PostgreSQL 16 — عزل Serializable + أقفال صفوف FOR UPDATE</li>
            <li>• WAL continuous archiving مُفعّل (استرجاع لأي نقطة زمنية)</li>
            <li>• Redis 7 — كاش اختياري لمؤشرات لوحة القيادة (لا يُستخدم في أقفال المخزون)</li>
            <li>• pg_trgm GIN — بحث فوري على OEM والاسم العربي</li>
            <li>• سجل تدقيق على مستوى الصف لكل عملية مالية (متاح من صفحة سجل التدقيق)</li>
            <li>• دفتر حركة مخزون Append-only غير قابل للحذف</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

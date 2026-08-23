"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, LogOut } from "lucide-react";
import { changeOwnPasswordAction } from "@/server/actions/auth.actions";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const passwordOk = form.newPassword.length >= 10 && /[A-Za-z]/.test(form.newPassword) && /[0-9]/.test(form.newPassword) && form.newPassword === form.confirmPassword;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await changeOwnPasswordAction(form);
      if (!result.success) { setError(result.error); return; }
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      onClose();
      router.replace("/login");
      router.refresh();
    });
  };

  return <Modal open={open} onClose={onClose} title="تعديل بيانات الحساب وتغيير كلمة المرور" description="تأكد من كلمة المرور الحالية ثم اختر كلمة جديدة قوية. ستُنهى جميع الجلسات السابقة وسيُطلب تسجيل الدخول من جديد." size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button onClick={submit} loading={pending} disabled={!form.currentPassword || !passwordOk}><LogOut size={15} /> حفظ والخروج من الجلسات</Button></>}>
    <div className="space-y-3">
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Field label="كلمة المرور الحالية" required><div className="relative"><KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bmw-muted" /><Input type={show ? "text" : "password"} value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} autoComplete="current-password" dir="ltr" className="pl-9 text-left" /><button type="button" onClick={() => setShow((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted hover:text-white" aria-label="إظهار أو إخفاء كلمات المرور">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></Field>
      <Field label="كلمة المرور الجديدة" required hint="١٠ خانات على الأقل، وتحتوي على حروف وأرقام"><Input type={show ? "text" : "password"} value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} autoComplete="new-password" dir="ltr" className="text-left" /></Field>
      <Field label="تأكيد كلمة المرور" required error={form.confirmPassword && form.confirmPassword !== form.newPassword ? "تأكيد كلمة المرور الجديدة غير مطابق." : undefined}><Input type={show ? "text" : "password"} value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} autoComplete="new-password" dir="ltr" className="text-left" /></Field>
    </div>
  </Modal>;
}

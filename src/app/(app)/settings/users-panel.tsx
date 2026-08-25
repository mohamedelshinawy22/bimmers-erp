"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Power, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, formatInt } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/permissions";
import type { ManagedUser } from "@/server/services/audit.service";
import { createUserAction, deleteManagedUserPermanentlyAction, toggleUserActiveAction } from "@/server/actions/auth.actions";
import { ChangePasswordModal } from "@/components/auth/change-password-modal";
import { UserPermissionsModal } from "@/components/users/user-permissions-modal";

/**
 * Operator management.
 *
 * Backs the `user.manage` permission, which previously implied an
 * account-management screen that did not exist — users could only be created by
 * the seed script.
 */
export function UsersPanel({ users, currentUserId, tenantQuota, treasuries, warehouses }: { users: ManagedUser[]; currentUserId: string; tenantQuota: { maxSubUsers: number; activeSubUsers: number } | null; treasuries: Array<{ id: string; name: string; type: string }>; warehouses: string[] }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [permissionsTarget, setPermissionsTarget] = useState<ManagedUser | null>(null);
  const quotaReached = Boolean(tenantQuota && tenantQuota.activeSubUsers >= tenantQuota.maxSubUsers);

  const toggle = (userId: string) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await toggleUserActiveAction(userId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setNotice(res.data.message);
      router.refresh();
    });
  };

  const removePermanently = (user: ManagedUser) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await deleteManagedUserPermanentlyAction(user.id);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setDeleteTarget(null);
      setNotice(res.data.message);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Users size={18} className="text-bmw-blue" /> المستخدمون والصلاحيات
          <Badge variant="muted" mono>
            {users.length}
          </Badge>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {tenantQuota ? <Badge variant={quotaReached ? "danger" : "muted"}>المستخدمون الفرعيون: {tenantQuota.activeSubUsers} / {tenantQuota.maxSubUsers}</Badge> : null}
          <Button size="sm" variant="outline" onClick={() => setPasswordOpen(true)}><KeyRound size={15} /> تعديل بيانات الحساب وتغيير كلمة المرور</Button>
          <Button size="sm" onClick={() => setAddOpen(true)} disabled={quotaReached} title={quotaReached ? "تم الوصول إلى حد المستخدمين الفرعيين للخطة" : undefined}><UserPlus size={15} /> مستخدم جديد</Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}
        <Table>
          <THead>
            <TR>
              <TH>اسم المستخدم</TH>
              <TH>الاسم الكامل</TH>
              <TH>الدور</TH>
              <TH>الفواتير</TH>
              <TH>آخر دخول</TH>
              <TH>الحالة</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id} className={u.isActive ? undefined : "opacity-50"}>
                <TD className="font-mono text-xs font-bold text-white" dir="ltr">
                  @{u.username}
                </TD>
                <TD className="text-sm">{u.fullName}</TD>
                <TD>
                  <Badge variant={u.role === "SUPER_ADMIN" ? "blue" : "muted"}>
                    <ShieldCheck size={11} />
                    {ROLE_LABELS[u.role as keyof typeof ROLE_LABELS] ?? u.role}
                  </Badge>
                </TD>
                <TD className="tabular text-xs text-bmw-muted">{formatInt(u.invoiceCount)}</TD>
                <TD className="tabular text-xs text-bmw-muted">
                  {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "لم يسجّل دخول"}
                </TD>
                <TD>
                  {u.isActive ? (
                    <Badge variant="success">نشط</Badge>
                  ) : (
                    <Badge variant="danger">موقوف</Badge>
                  )}
                </TD>
                <TD>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => setPermissionsTarget(u)} disabled={pending} title="تعديل الدور وتخصيص الصلاحيات" className="rounded-lg border border-bmw-blue/35 bg-bmw-blue/10 p-1.5 text-bmw-blue transition-colors hover:bg-bmw-blue/20 disabled:opacity-40"><ShieldCheck size={14} /></button>
                    {u.id === currentUserId ? (
                      <span className="text-[10px] text-bmw-muted">حسابك</span>
                    ) : u.role === "SUPER_ADMIN" ? (
                      <span className="text-[10px] text-bmw-blue">الحساب الرئيسي</span>
                    ) : <>
                      <button type="button" onClick={() => toggle(u.id)} disabled={pending} title={u.isActive ? "إيقاف الحساب" : "تنشيط الحساب"} className={`rounded-lg border p-1.5 transition-colors disabled:opacity-40 ${u.isActive ? "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"}`}><Power size={14} /></button>
                      <button type="button" onClick={() => setDeleteTarget(u)} disabled={pending} title="حذف المستخدم نهائياً" className="rounded-lg border border-bmw-mRed/35 bg-bmw-mRed/10 p-1.5 text-bmw-mRed transition-colors hover:bg-bmw-mRed/20 disabled:opacity-40"><Trash2 size={14} /></button>
                    </>}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} quotaReached={quotaReached} />
      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
      <DeleteUserModal user={deleteTarget} pending={pending} onClose={() => setDeleteTarget(null)} onConfirm={removePermanently} />
      {permissionsTarget ? <UserPermissionsModal user={permissionsTarget} treasuries={treasuries} warehouses={warehouses} onClose={() => setPermissionsTarget(null)} onSaved={() => { setPermissionsTarget(null); router.refresh(); }} /> : null}
    </Card>
  );
}

function DeleteUserModal({ user, pending, onClose, onConfirm }: { user: ManagedUser | null; pending: boolean; onClose: () => void; onConfirm: (user: ManagedUser) => void }) {
  if (!user) return null;
  const blockedByInvoices = user.invoiceCount > 0;
  return <Modal open onClose={onClose} title="تأكيد الحذف النهائي للمستخدم" description="لا يمكن التراجع عن الحذف بعد اكتماله." size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button variant="danger" onClick={() => onConfirm(user)} loading={pending} disabled={blockedByInvoices}><Trash2 size={15} /> حذف نهائي</Button></>}><div className="space-y-3"><p className="text-sm text-white">هل أنت متأكد من رغبتك في حذف حساب <strong dir="ltr">@{user.username}</strong> نهائياً؟</p>{blockedByInvoices ? <Alert variant="warning">تنبيه حماية السجلات المالية: لا يمكن حذف هذا المستخدم نهائياً لوجود ({user.invoiceCount}) فاتورة مرتبطة به. يمكنك إيقاف الحساب بدلاً من الحذف.</Alert> : <Alert variant="warning">سيتحقق النظام أيضاً من السندات وحركات المخزون والسجلات التشغيلية قبل تنفيذ الحذف.</Alert>}</div></Modal>;
}

function AddUserModal({ open, onClose, quotaReached }: { open: boolean; onClose: () => void; quotaReached: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    username: "",
    fullName: "",
    password: "",
    role: "CASHIER" as "SUPER_ADMIN" | "MANAGER" | "CASHIER" | "STOREKEEPER",
  });

  const passwordOk = form.password.length >= 10 && /[A-Za-z]/.test(form.password) && /[0-9]/.test(form.password);

  const submit = () => {
    setError(null);
    if (quotaReached) { setError("تم الوصول إلى الحد الأقصى للمستخدمين الفرعيين في الخطة الحالية."); return; }
    startTransition(async () => {
      const res = await createUserAction(form);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setForm({ username: "", fullName: "", password: "", role: "CASHIER" });
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إضافة مستخدم جديد"
      description="كلمة المرور تُخزَّن بتشفير bcrypt ولا يمكن استرجاعها — سلّمها للمستخدم مباشرة."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={quotaReached || form.username.length < 3 || form.fullName.length < 2 || !passwordOk}
          >
            <UserPlus size={15} /> إنشاء المستخدم
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {quotaReached ? <Alert variant="warning">تم الوصول إلى حد المستخدمين الفرعيين المسموح به في هذه الخطة.</Alert> : null}
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Field label="اسم المستخدم" required hint="حروف إنجليزية وأرقام فقط">
          <Input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            dir="ltr"
            className="text-left font-mono"
            placeholder="cashier1"
          />
        </Field>
        <Field label="الاسم الكامل" required>
          <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="الدور" required>
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}>
            <option value="CASHIER">كاشير</option>
            <option value="STOREKEEPER">أمين مخزن</option>
            <option value="MANAGER">مدير</option>
            <option value="SUPER_ADMIN">مدير النظام</option>
          </Select>
        </Field>
        <Field
          label="كلمة المرور"
          required
          error={form.password && !passwordOk ? "١٠ خانات على الأقل مع حروف وأرقام" : undefined}
        >
          <div className="relative">
            <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bmw-muted" />
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              dir="ltr"
              className="pl-9 text-left"
            />
          </div>
        </Field>
      </div>
    </Modal>
  );
}

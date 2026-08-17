"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Power, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, formatInt } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/permissions";
import type { ManagedUser } from "@/server/services/audit.service";
import { createUserAction, toggleUserActiveAction } from "@/server/actions/auth.actions";

/**
 * Operator management.
 *
 * Backs the `user.manage` permission, which previously implied an
 * account-management screen that did not exist — users could only be created by
 * the seed script.
 */
export function UsersPanel({ users, currentUserId }: { users: ManagedUser[]; currentUserId: string }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (userId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await toggleUserActiveAction(userId);
      if (!res.success) {
        setError(res.error);
        return;
      }
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
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus size={15} /> مستخدم جديد
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}
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
                  {u.id === currentUserId ? (
                    <span className="text-[10px] text-bmw-muted">حسابك</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggle(u.id)}
                      disabled={pending}
                      title={u.isActive ? "إيقاف الحساب" : "تنشيط الحساب"}
                      className={`rounded-lg p-1.5 transition-colors disabled:opacity-40 ${
                        u.isActive
                          ? "text-bmw-muted hover:bg-bmw-mRed/10 hover:text-bmw-mRed"
                          : "text-bmw-muted hover:bg-emerald-500/10 hover:text-emerald-400"
                      }`}
                    >
                      <Power size={14} />
                    </button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} />
    </Card>
  );
}

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
            disabled={form.username.length < 3 || form.fullName.length < 2 || !passwordOk}
          >
            <UserPlus size={15} /> إنشاء المستخدم
          </Button>
        </>
      }
    >
      <div className="space-y-3">
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

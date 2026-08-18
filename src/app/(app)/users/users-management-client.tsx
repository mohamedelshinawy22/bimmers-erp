"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Power, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Alert } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { UserPermissionsModal } from "@/components/users/user-permissions-modal";
import { toggleUserActiveAction } from "@/server/actions/auth.actions";
import type { ManagedUser } from "@/server/services/audit.service";
import { ROLE_LABELS } from "@/lib/permissions";

export function UsersManagementClient({ users, currentUserId, treasuries, warehouses }: { users: ManagedUser[]; currentUserId: string; treasuries: Array<{ id: string; name: string; type: string }>; warehouses: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ManagedUser | "NEW" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const treasuryName = new Map(treasuries.map((treasury) => [treasury.id, treasury.name]));
  const toggle = (user: ManagedUser) => startTransition(async () => {
    setError(null);
    const result = await toggleUserActiveAction(user.id);
    if (!result.success) { setError(result.error); return; }
    router.refresh();
  });
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue"><Users size={22} /></div><div><h1 className="text-lg font-bold text-white">المستخدمون والصلاحيات</h1><p className="text-xs text-bmw-muted">إدارة المشغلين، نطاق المخازن والخزائن، والحدود التشغيلية الدقيقة.</p></div></div><Button onClick={() => setEditing("NEW")}><UserPlus size={16} /> مستخدم جديد</Button></div>{error ? <Alert variant="error">{error}</Alert> : null}<Card><CardHeader><CardTitle><ShieldCheck size={18} className="text-bmw-blue" /> سجل المستخدمين <Badge variant="muted" mono>{users.length}</Badge></CardTitle></CardHeader><CardContent><Table><THead><TR><TH>اسم المستخدم</TH><TH>الاسم الكامل</TH><TH>الحالة</TH><TH>المخازن المسموح بها</TH><TH>الخزائن المسموح بها</TH><TH>الدور / الصلاحيات</TH><TH>إجراءات</TH></TR></THead><TBody>{users.length === 0 ? <EmptyState colSpan={7} title="لا يوجد مستخدمون" icon={<Users size={30} />} /> : users.map((user) => <TR key={user.id} className={user.isActive ? undefined : "opacity-55"}><TD dir="ltr" className="font-mono text-xs font-bold text-white">@{user.username}</TD><TD className="font-medium">{user.fullName}</TD><TD><Badge variant={user.isActive ? "success" : "muted"}>{user.isActive ? "نشط" : "معطل"}</Badge></TD><TD className="max-w-[180px] text-xs">{user.allowedWarehouseIds.length ? user.allowedWarehouseIds.join("، ") : <span className="text-bmw-muted">كل المخازن</span>}</TD><TD className="max-w-[190px] text-xs">{user.allowedTreasuryIds.length ? user.allowedTreasuryIds.map((id) => treasuryName.get(id) ?? "خزينة محذوفة").join("، ") : <span className="text-bmw-muted">كل الخزائن النشطة</span>}</TD><TD><div className="space-y-1"><Badge variant={user.role === "SUPER_ADMIN" ? "blue" : "muted"}>{ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role}</Badge><p className="text-[10px] text-bmw-muted">{user.permissions ? "صلاحيات مخصصة" : "صلاحيات الدور الافتراضية"}</p></div></TD><TD><div className="flex items-center gap-1"><Button size="sm" variant="ghost" onClick={() => setEditing(user)} title="تعديل المستخدم والصلاحيات"><Pencil size={14} /></Button>{user.id === currentUserId ? <span className="px-1 text-[10px] text-bmw-muted">حسابك</span> : <Button size="sm" variant="ghost" className={user.isActive ? "text-bmw-mRed hover:bg-bmw-mRed/10 hover:text-bmw-mRed" : "text-emerald-400 hover:bg-emerald-500/10"} onClick={() => toggle(user)} disabled={pending} title={user.isActive ? "تعطيل المستخدم" : "تنشيط المستخدم"}><Power size={14} /></Button>}</div></TD></TR>)}</TBody></Table></CardContent></Card>{editing ? <UserPermissionsModal key={editing === "NEW" ? "new" : editing.id} user={editing === "NEW" ? null : editing} treasuries={treasuries} warehouses={warehouses} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh(); }} /> : null}</div>;
}

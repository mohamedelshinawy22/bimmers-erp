"use client";

import { useState, useTransition } from "react";
import { KeyRound, Save, ShieldCheck } from "lucide-react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import type { ManagedUser, ManagedUserPermission } from "@/server/services/audit.service";
import type { PermissionBooleanKey, UserPermissionInput } from "@/lib/validations/users";
import { createManagedUserAction, updateManagedUserAction } from "@/server/actions/users.actions";
import { ROLE_LABELS } from "@/lib/permissions";

type Role = "SUPER_ADMIN" | "MANAGER" | "CASHIER" | "STOREKEEPER";
type Tab = "general" | "invoices" | "inventory" | "accounts" | "treasury" | "reports";
type FormState = {
  username: string; fullName: string; password: string; role: Role; isActive: boolean;
  allowedWarehouseIds: string[]; allowedTreasuryIds: string[]; transferToTreasuryId: string; permissions: UserPermissionInput;
};

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "general", label: "صلاحيات عامة" }, { id: "invoices", label: "الفواتير" }, { id: "inventory", label: "البضاعة" },
  { id: "accounts", label: "الحسابات" }, { id: "treasury", label: "الخزينة" }, { id: "reports", label: "تقارير متقدمة" },
];

const boolKeys: PermissionBooleanKey[] = [
  "canManageProgram", "canBackup", "canRestoreBackup", "canEditInvoiceNumber", "canEditDateTime", "viewTodayInvoicesOnly", "editTodayInvoicesOnly", "canSendEInvoices",
  "canViewSalesInvoices", "canCreateSalesInvoices", "canEditSalesInvoices", "canDeleteSalesInvoices", "canEditSellingPrice", "canCreditSale", "canEditSaleVat", "canAddDiscount", "canSellBelowMinPrice", "canSellBelowCost", "canSalesReturn", "canViewInvoiceProfit", "canViewQuotations", "canManageQuotations", "canViewPurchaseInvoices", "canCreatePurchaseInvoices", "canEditPurchaseInvoices", "canDeletePurchaseInvoices", "canCreditPurchase", "canEditPurchaseVat", "canPurchaseReturn", "canManageInventoryAudit", "canManageBranchTransfers", "canManageAdjustments", "canManageExpenses", "canManageReceipts", "canTransferTreasury", "canBypassTreasuryImpact",
  "canViewParts", "canCreateParts", "canEditParts", "canDeleteParts", "canViewPartLedger", "canViewStockReport", "canViewCostPrice", "canNegativeSell", "canPrintBarcodes",
  "canViewAccounts", "canCreateAccounts", "canEditAccounts", "canDeleteAccounts", "canViewAccountBalance", "canViewAccountStatement",
  "canViewTreasuryBalance", "canAnalyzeReceipts", "canAnalyzeExpenses", "canAccessAdvancedReports", "canViewDailyMovementReport", "canViewSalesAnalysis", "canViewPurchaseAnalysis",
];

function basePermissions(role: Role): UserPermissionInput {
  const values = Object.fromEntries(boolKeys.map((key) => [key, false])) as Record<PermissionBooleanKey, boolean>;
  if (role === "SUPER_ADMIN") for (const key of boolKeys) values[key] = true;
  if (role === "MANAGER") for (const key of boolKeys) values[key] = true;
  if (role === "CASHIER") Object.assign(values, { canViewParts: true, canViewSalesInvoices: true, canCreateSalesInvoices: true, canCreditSale: true, canAddDiscount: true, canSalesReturn: true, canViewAccounts: true, canCreateAccounts: true, canEditAccounts: true, canViewAccountBalance: true, canViewAccountStatement: true, canViewTreasuryBalance: true, canManageReceipts: true, canPrintBarcodes: true });
  if (role === "STOREKEEPER") Object.assign(values, { canViewParts: true, canCreateParts: true, canEditParts: true, canViewPartLedger: true, canViewStockReport: true, canViewCostPrice: true, canPrintBarcodes: true, canViewPurchaseInvoices: true, canCreatePurchaseInvoices: true });
  return { ...values, maxDiscountPercent: role === "SUPER_ADMIN" || role === "MANAGER" ? 100 : 0, maxDiscountValue: role === "SUPER_ADMIN" || role === "MANAGER" ? 99_999_999 : 0, allowedAccountTypes: ["CUSTOMER", "SUPPLIER"] };
}

function fromUser(user: ManagedUser | null): FormState {
  const role = (user?.role ?? "CASHIER") as Role;
  return {
    username: user?.username ?? "", fullName: user?.fullName ?? "", password: "", role, isActive: user?.isActive ?? true,
    allowedWarehouseIds: user?.allowedWarehouseIds ?? [], allowedTreasuryIds: user?.allowedTreasuryIds ?? [], transferToTreasuryId: user?.transferToTreasuryId ?? "",
    permissions: user?.permissions ? { ...basePermissions(role), ...user.permissions, allowedAccountTypes: user.permissions.allowedAccountTypes.filter((value): value is "CUSTOMER" | "SUPPLIER" | "EMPLOYEE" => value === "CUSTOMER" || value === "SUPPLIER" || value === "EMPLOYEE") } : basePermissions(role),
  };
}

function PermissionCheck({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string }) {
  return <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-bmw-cardBorder bg-bmw-carbon/40 p-2 text-xs text-bmw-silver transition hover:border-bmw-blue/40"><input type="checkbox" className="mt-0.5 accent-bmw-blue" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><span className="block font-medium text-white">{label}</span>{hint ? <span className="mt-0.5 block text-[10px] text-bmw-muted">{hint}</span> : null}</span></label>;
}

function OperationGrid({ title, rows, permissions, toggle }: { title: string; rows: Array<{ label: string; keys: Array<PermissionBooleanKey | null> }>; permissions: UserPermissionInput; toggle: (key: PermissionBooleanKey, value: boolean) => void }) {
  return <section className="space-y-2"><p className="text-xs font-bold text-bmw-blue">{title}</p><div className="overflow-x-auto rounded-xl border border-bmw-cardBorder"><table className="w-full min-w-[460px] text-right text-xs"><thead className="bg-bmw-carbon text-bmw-muted"><tr><th className="p-2">العملية</th>{["عرض", "جديد", "تعديل", "حذف"].map((column) => <th key={column} className="p-2 text-center">{column}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.label} className="border-t border-bmw-cardBorder"><td className="p-2 font-medium text-white">{row.label}</td>{row.keys.map((key, index) => <td key={`${row.label}-${index}`} className="p-2 text-center">{key ? <input aria-label={`${row.label} ${index}`} type="checkbox" className="accent-bmw-blue" checked={permissions[key]} onChange={(event) => toggle(key, event.target.checked)} /> : "—"}</td>)}</tr>)}</tbody></table></div></section>;
}

export function UserPermissionsModal({ user, treasuries, warehouses, onClose, onSaved }: { user: ManagedUser | null; treasuries: Array<{ id: string; name: string; type: string }>; warehouses: string[]; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = useState<Tab>("general");
  const [form, setForm] = useState<FormState>(() => fromUser(user));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const isNew = !user;
  const passwordOk = !isNew || (form.password.length >= 10 && /[A-Za-z]/.test(form.password) && /[0-9]/.test(form.password));
  const setPermission = (key: PermissionBooleanKey, value: boolean) => setForm((current) => ({ ...current, permissions: { ...current.permissions, [key]: value } }));
  const setSetValue = (field: "allowedWarehouseIds" | "allowedTreasuryIds", value: string, checked: boolean) => setForm((current) => ({ ...current, [field]: checked ? [...new Set([...current[field], value])] : current[field].filter((item) => item !== value) }));
  const changeRole = (role: Role) => setForm((current) => ({ ...current, role, permissions: user?.permissions ? current.permissions : basePermissions(role) }));
  const submit = () => startTransition(async () => {
    setError(null);
    const payload = { ...form, transferToTreasuryId: form.transferToTreasuryId || undefined };
    const result = user ? await updateManagedUserAction({ ...payload, id: user.id }) : await createManagedUserAction(payload);
    if (!result.success) { setError(result.error); return; }
    onSaved();
  });
  const renderChecks = (items: Array<[PermissionBooleanKey, string, string?]>) => <div className="grid gap-2 md:grid-cols-2">{items.map(([key, label, hint]) => <PermissionCheck key={key} label={label} hint={hint} checked={form.permissions[key]} onChange={(value) => setPermission(key, value)} />)}</div>;

  return <Modal open onClose={onClose} title={isNew ? "مستخدم جديد وصلاحياته" : `صلاحيات المستخدم — ${user.username}`} description="تُطبق الصلاحيات من الخادم، ولا تعتمد الحماية على إخفاء أزرار الواجهة فقط." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>تراجع</Button><Button onClick={submit} loading={pending} disabled={form.username.trim().length < 3 || form.fullName.trim().length < 2 || !passwordOk}><Save size={15} /> حفظ</Button></>}>
    <div className="space-y-4">
      {error ? <Alert variant="error">{error}</Alert> : null}
      <div className="grid gap-3 md:grid-cols-2"><Field label="اسم المستخدم" required><Input dir="ltr" className="text-left font-mono" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoFocus /></Field><Field label="الاسم الكامل" required><Input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></Field><Field label={isNew ? "كلمة المرور" : "كلمة مرور جديدة (اختياري)"} required={isNew} error={form.password && !passwordOk ? "١٠ خانات على الأقل مع حروف وأرقام" : undefined}><div className="relative"><KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bmw-muted" /><Input type="password" dir="ltr" className="pl-9 text-left" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></div></Field><Field label="الدور" required><Select value={form.role} onChange={(event) => changeRole(event.target.value as Role)}>{(["CASHIER", "STOREKEEPER", "MANAGER", "SUPER_ADMIN"] as Role[]).map((role) => <option value={role} key={role}>{ROLE_LABELS[role]}</option>)}</Select></Field></div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-bmw-silver"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="accent-bmw-blue" />مستخدم نشط</label>
      <div className="flex flex-wrap gap-1 border-b border-bmw-cardBorder pb-3">{tabs.map((item) => <button type="button" key={item.id} onClick={() => setTab(item.id)} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${tab === item.id ? "bg-bmw-blue text-white" : "text-bmw-muted hover:bg-bmw-card hover:text-white"}`}>{item.label}</button>)}</div>
      {tab === "general" ? <div className="space-y-4"><div className="grid gap-2 md:grid-cols-2">{renderChecks([["canManageProgram", "إدارة البرنامج"], ["canBackup", "عمل نسخة احتياطية"], ["canRestoreBackup", "استرجاع نسخة"], ["canEditInvoiceNumber", "تعديل أرقام الفواتير"], ["canEditDateTime", "تعديل التاريخ والوقت"], ["viewTodayInvoicesOnly", "عرض فواتير اليوم فقط"], ["editTodayInvoicesOnly", "تعديل فواتير اليوم فقط"], ["canSendEInvoices", "إرسال الفواتير الإلكترونية"]])}</div><section className="grid gap-3 md:grid-cols-2"><div><p className="mb-2 text-xs font-bold text-bmw-blue">المخازن المسموح بها</p><div className="space-y-1.5">{warehouses.length ? warehouses.map((warehouse) => <PermissionCheck key={warehouse} label={warehouse} checked={form.allowedWarehouseIds.includes(warehouse)} onChange={(checked) => setSetValue("allowedWarehouseIds", warehouse, checked)} />) : <p className="text-xs text-bmw-muted">لا توجد مخازن معرفة؛ سيبقى الوصول غير مقيد.</p>}</div></div><div><p className="mb-2 text-xs font-bold text-bmw-blue">الخزائن المسموح بها</p><div className="space-y-1.5">{treasuries.map((treasury) => <PermissionCheck key={treasury.id} label={treasury.name} hint={treasury.type} checked={form.allowedTreasuryIds.includes(treasury.id)} onChange={(checked) => setSetValue("allowedTreasuryIds", treasury.id, checked)} />)}</div></div></section><Field label="تحويل النقدية فقط إلى خزينة محددة"><Select value={form.transferToTreasuryId} onChange={(event) => setForm({ ...form, transferToTreasuryId: event.target.value })}><option value="">— دون تقييد —</option>{treasuries.filter((treasury) => form.allowedTreasuryIds.includes(treasury.id)).map((treasury) => <option key={treasury.id} value={treasury.id}>{treasury.name}</option>)}</Select></Field></div> : null}
      {tab === "invoices" ? <div className="space-y-4"><OperationGrid title="عمليات المستندات" permissions={form.permissions} toggle={setPermission} rows={[{ label: "المبيعات", keys: ["canViewSalesInvoices", "canCreateSalesInvoices", "canEditSalesInvoices", "canDeleteSalesInvoices"] }, { label: "المشتريات", keys: ["canViewPurchaseInvoices", "canCreatePurchaseInvoices", "canEditPurchaseInvoices", "canDeletePurchaseInvoices"] }, { label: "المرتجعات", keys: ["canSalesReturn", "canSalesReturn", "canSalesReturn", "canSalesReturn"] }, { label: "عروض الأسعار", keys: ["canViewQuotations", "canManageQuotations", "canManageQuotations", "canManageQuotations"] }, { label: "المصروفات", keys: ["canManageExpenses", "canManageExpenses", "canManageExpenses", "canManageExpenses"] }, { label: "القبض والصرف", keys: ["canManageReceipts", "canManageReceipts", "canManageReceipts", "canManageReceipts"] }, { label: "تحويلات الفروع", keys: ["canManageBranchTransfers", "canManageBranchTransfers", "canManageBranchTransfers", "canManageBranchTransfers"] }]}/><section className="grid gap-3 md:grid-cols-2"><Field label="أعلى نسبة خصم %"><Input type="number" min={0} max={100} step="0.01" value={form.permissions.maxDiscountPercent} onChange={(event) => setForm({ ...form, permissions: { ...form.permissions, maxDiscountPercent: Number(event.target.value) || 0 } })} /></Field><Field label="أعلى قيمة خصم"><Input type="number" min={0} step="0.01" value={form.permissions.maxDiscountValue} onChange={(event) => setForm({ ...form, permissions: { ...form.permissions, maxDiscountValue: Number(event.target.value) || 0 } })} /></Field></section>{renderChecks([["canEditSellingPrice", "تعديل أسعار البيع"], ["canCreditSale", "البيع بالأجل"], ["canSellBelowCost", "البيع بأقل من التكلفة"], ["canViewInvoiceProfit", "عرض أرباح الفاتورة"], ["canBypassTreasuryImpact", "إلغاء تأثير الخزينة"], ["canEditSaleVat", "تعديل الضريبة"], ["canAddDiscount", "إضافة خصم"], ["canSellBelowMinPrice", "البيع بأقل من الحد الأدنى"], ["canCreditPurchase", "الشراء بالأجل"], ["canEditPurchaseVat", "تعديل ضريبة الشراء"]])}</div> : null}
      {tab === "inventory" ? <div className="space-y-3">{renderChecks([["canViewParts", "عرض الأصناف"], ["canCreateParts", "إضافة صنف"], ["canEditParts", "تعديل صنف"], ["canDeleteParts", "حذف صنف"], ["canViewPartLedger", "تقرير حركة الصنف"], ["canViewStockReport", "تقرير بضاعة مخزن"], ["canViewCostPrice", "يمكنه معرفة تكلفة الأصناف", "يحجب السعر والتكلفة من POS والكتالوج عند إلغائها"], ["canNegativeSell", "البيع بالسالب/كميات غير متاحة"], ["canPrintBarcodes", "طباعة ملصقات الباركود"], ["canManageInventoryAudit", "إدارة الجرد"], ["canManageAdjustments", "تسويات المخزون"]])}</div> : null}
      {tab === "accounts" ? <div className="space-y-4">{renderChecks([["canViewAccounts", "عرض الحسابات"], ["canCreateAccounts", "إضافة حساب"], ["canEditAccounts", "تعديل حساب"], ["canDeleteAccounts", "حذف حساب"], ["canViewAccountBalance", "رصيد الحساب"], ["canViewAccountStatement", "كشف حساب"]])}<section><p className="mb-2 text-xs font-bold text-bmw-blue">أنواع الحسابات المسموح بها</p><div className="grid gap-2 md:grid-cols-3">{(["CUSTOMER", "SUPPLIER", "EMPLOYEE"] as const).map((type) => <PermissionCheck key={type} label={type === "CUSTOMER" ? "عميل" : type === "SUPPLIER" ? "مورد" : "مندوب بيع / موظف"} checked={form.permissions.allowedAccountTypes.includes(type)} onChange={(checked) => setForm({ ...form, permissions: { ...form.permissions, allowedAccountTypes: checked ? [...new Set([...form.permissions.allowedAccountTypes, type])] : form.permissions.allowedAccountTypes.filter((current) => current !== type) } })} />)}</div></section></div> : null}
      {tab === "treasury" ? <div className="space-y-3">{renderChecks([["canViewTreasuryBalance", "عرض حركة الخزينة ورصيدها"], ["canAnalyzeReceipts", "تحليل المقبوضات"], ["canAnalyzeExpenses", "تحليل المصروفات"], ["canManageReceipts", "تسجيل سندات القبض والصرف"], ["canTransferTreasury", "تحويل من خزينة لأخرى"], ["canBypassTreasuryImpact", "إلغاء تأثير الخزينة"]])}</div> : null}
      {tab === "reports" ? <div className="space-y-3">{renderChecks([["canAccessAdvancedReports", "تقارير متقدمة"], ["canViewDailyMovementReport", "تقرير الحركة اليومية"], ["canViewSalesAnalysis", "تقرير تحليل المبيعات"], ["canViewPurchaseAnalysis", "تقرير تحليل المشتريات"]])}</div> : null}
    </div>
  </Modal>;
}

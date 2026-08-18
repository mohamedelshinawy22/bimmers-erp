"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Car, FileText, Pencil, Plus, Search, UserRound, Users, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ARABIC_LABELS, CURRENCY, formatDateTime, formatInt, formatMoney } from "@/lib/utils";
import type { AccountRow } from "@/server/services/accounts.service";
import { createAccountAction, createVehicleAction, updateAccountAction } from "@/server/actions/accounts.actions";
import { getAccountStatementAction } from "@/server/actions/invoices.read.actions";
import { ARABIC_LABELS as LABELS } from "@/lib/utils";

interface AccountsClientProps {
  rows: AccountRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: { query: string; type: string; debtorsOnly: boolean };
  options: {
    chassis: Array<{ id: string; code: string; series: string }>;
    engines: Array<{ id: string; code: string; displacement: string | null }>;
  };
  canWrite: boolean;
  canViewStatement: boolean;
  totals: { receivables: number; payables: number; workshops: number };
}

const TYPE_TABS = [
  { value: "ALL", label: "الكل" },
  { value: "WORKSHOP_BMW", label: "ورش BMW" },
  { value: "CUSTOMER", label: "عملاء" },
  { value: "SUPPLIER", label: "موردون" },
  { value: "EXPENSE", label: "مصروفات" },
] as const;

export function AccountsClient({
  rows,
  total,
  page,
  pageSize,
  filters,
  options,
  canWrite,
  canViewStatement,
  totals,
}: AccountsClientProps) {
  const router = useRouter();
  const [query, setQuery] = useState(filters.query);
  const [addOpen, setAddOpen] = useState(false);
  const [vehicleFor, setVehicleFor] = useState<AccountRow | null>(null);
  const [editAccount, setEditAccount] = useState<AccountRow | null>(null);
  const [statementFor, setStatementFor] = useState<AccountRow | null>(null);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const merged = { q: filters.query, type: filters.type, debtors: filters.debtorsOnly ? "1" : "", ...patch };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    router.push(`/accounts?${next.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue">
            <Users size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">الحسابات والورش وجراج العملاء</h1>
            <p className="text-xs text-bmw-muted">{formatInt(total)} حساب مسجّل</p>
          </div>
        </div>
        {canWrite ? (
          <Button onClick={() => setAddOpen(true)}>
            <Plus size={16} /> حساب جديد
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-bmw-cardBorder bg-bmw-card p-4">
          <p className="text-xs text-bmw-muted">إجمالي المديونيات (لنا)</p>
          <p className="tabular mt-1 text-xl font-bold text-amber-400">
            {formatMoney(totals.receivables)} <span className="text-xs text-bmw-muted">{CURRENCY}</span>
          </p>
        </div>
        <div className="rounded-2xl border border-bmw-cardBorder bg-bmw-card p-4">
          <p className="text-xs text-bmw-muted">مستحقات الموردين (علينا)</p>
          <p className="tabular mt-1 text-xl font-bold text-purple-400">
            {formatMoney(totals.payables)} <span className="text-xs text-bmw-muted">{CURRENCY}</span>
          </p>
        </div>
        <div className="rounded-2xl border border-bmw-cardBorder bg-bmw-card p-4">
          <p className="text-xs text-bmw-muted">عدد ورش BMW المتعاقدة</p>
          <p className="tabular mt-1 text-xl font-bold text-bmw-blue">{formatInt(totals.workshops)}</p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            {TYPE_TABS.map((tab) => (
              <Button
                key={tab.value}
                size="sm"
                variant={filters.type === tab.value || (tab.value === "ALL" && !filters.type) ? "primary" : "outline"}
                onClick={() => push({ type: tab.value === "ALL" ? null : tab.value })}
              >
                {tab.label}
              </Button>
            ))}
            <Button
              size="sm"
              variant={filters.debtorsOnly ? "danger" : "outline"}
              onClick={() => push({ debtors: filters.debtorsOnly ? null : "1" })}
            >
              <Wallet size={14} /> المدينون فقط
            </Button>
          </div>

          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              push({ q: query || null });
            }}
          >
            <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بالاسم، كود الحساب، التليفون، أو الرقم الضريبي…"
              className="pr-9"
            />
          </form>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <THead>
            <TR>
              <TH>كود الحساب</TH>
              <TH>الاسم</TH>
              <TH>النوع</TH>
              <TH>التليفون</TH>
              <TH>الرصيد</TH>
              <TH>حد الائتمان</TH>
              <TH>الاستهلاك</TH>
              <TH>السيارات</TH>
              <TH>فواتير مفتوحة</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <EmptyState
                colSpan={10}
                title="لا توجد حسابات مطابقة"
                description="أضف ورشة أو عميلاً جديداً لبدء البيع الآجل."
                icon={<Users size={32} />}
              />
            ) : (
              rows.map((account) => (
                <TR key={account.id} className={account.isActive ? undefined : "opacity-50"}>
                  <TD className="tabular whitespace-nowrap text-xs text-bmw-blue">{account.accountNumber}</TD>
                  <TD className="max-w-[220px]">
                    <p className="truncate font-bold text-white">{account.name}</p>
                    {account.taxNumber ? (
                      <p className="font-mono text-[10px] text-bmw-muted">ض: {account.taxNumber}</p>
                    ) : null}
                  </TD>
                  <TD>
                    <Badge
                      variant={
                        account.type === "WORKSHOP_BMW"
                          ? "oem"
                          : account.type === "SUPPLIER"
                            ? "purple"
                            : account.type === "EXPENSE"
                              ? "muted"
                              : "blue"
                      }
                    >
                      {ARABIC_LABELS.accountType[account.type]}
                    </Badge>
                  </TD>
                  <TD className="tabular whitespace-nowrap text-xs text-bmw-muted" dir="ltr">
                    {account.phone ?? "—"}
                  </TD>
                  <TD className="whitespace-nowrap">
                    <span
                      className={`tabular font-bold ${
                        account.currentBalance < 0
                          ? "text-bmw-mRed"
                          : account.currentBalance > 0
                            ? "text-emerald-400"
                            : "text-bmw-muted"
                      }`}
                    >
                      {formatMoney(Math.abs(account.currentBalance))}
                    </span>
                    <span className="mr-1 text-[10px] text-bmw-muted">
                      {account.currentBalance < 0 ? "عليه" : account.currentBalance > 0 ? "له" : ""}
                    </span>
                  </TD>
                  <TD className="tabular whitespace-nowrap text-xs text-bmw-muted">
                    {formatMoney(account.creditLimit)}
                  </TD>
                  <TD>
                    {account.creditUtilizationPercent === null ? (
                      <span className="text-[10px] text-bmw-muted">—</span>
                    ) : (
                      <div className="w-20">
                        <div className="h-1.5 overflow-hidden rounded-full bg-bmw-carbon">
                          <div
                            className={`h-full rounded-full ${
                              account.creditUtilizationPercent >= 100
                                ? "bg-bmw-mRed"
                                : account.creditUtilizationPercent >= 75
                                  ? "bg-amber-500"
                                  : "bg-emerald-500"
                            }`}
                            style={{ width: `${Math.min(100, account.creditUtilizationPercent)}%` }}
                          />
                        </div>
                        <p className="tabular mt-0.5 text-[10px] text-bmw-muted">
                          {account.creditUtilizationPercent.toFixed(0)}%
                        </p>
                      </div>
                    )}
                  </TD>
                  <TD className="tabular text-xs">{formatInt(account.vehicleCount)}</TD>
                  <TD>
                    {account.openInvoiceCount > 0 ? (
                      <Badge variant="warning" mono>
                        {account.openInvoiceCount}
                      </Badge>
                    ) : (
                      <span className="text-[10px] text-bmw-muted">—</span>
                    )}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1">
                      {canWrite ? (
                        <button
                          type="button"
                          onClick={() => setEditAccount(account)}
                          title="تعديل الحساب"
                          className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-bmw-blue/10 hover:text-bmw-blue"
                        >
                          <Pencil size={15} />
                        </button>
                      ) : null}
                      {canViewStatement ? (
                        <button
                          type="button"
                          onClick={() => setStatementFor(account)}
                          title="كشف حساب"
                          className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-purple-500/10 hover:text-purple-400"
                        >
                          <FileText size={15} />
                        </button>
                      ) : null}
                      {canWrite && account.type !== "EXPENSE" && account.type !== "SUPPLIER" ? (
                        <button
                          type="button"
                          onClick={() => setVehicleFor(account)}
                          title="إضافة سيارة"
                          className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-emerald-500/10 hover:text-emerald-400"
                        >
                          <Car size={15} />
                        </button>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        {pageCount > 1 ? (
          <div className="flex items-center justify-between border-t border-bmw-cardBorder px-4 py-3">
            <p className="text-xs text-bmw-muted">
              صفحة <span className="tabular font-bold text-white">{page}</span> من{" "}
              <span className="tabular">{pageCount}</span>
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => push({ page: String(page - 1) })}>
                السابق
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pageCount}
                onClick={() => push({ page: String(page + 1) })}
              >
                التالي
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {canWrite ? <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} /> : null}
      {editAccount ? (
        <EditAccountModal key={editAccount.id} account={editAccount} onClose={() => setEditAccount(null)} />
      ) : null}
      {statementFor ? (
        <StatementModal key={statementFor.id} account={statementFor} onClose={() => setStatementFor(null)} />
      ) : null}
      {vehicleFor ? (
        <AddVehicleModal
          key={vehicleFor.id}
          account={vehicleFor}
          options={options}
          onClose={() => setVehicleFor(null)}
        />
      ) : null}
    </div>
  );
}

function AddAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "WORKSHOP_BMW" as "CUSTOMER" | "WORKSHOP_BMW" | "SUPPLIER" | "EXPENSE",
    phone: "",
    email: "",
    address: "",
    taxNumber: "",
    creditLimit: "0",
    defaultPriceTier: "WHOLESALE" as "RETAIL" | "WHOLESALE",
    openingBalance: "0",
  });

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createAccountAction({
        name: form.name,
        type: form.type,
        phone: form.phone,
        email: form.email,
        address: form.address,
        taxNumber: form.taxNumber,
        creditLimit: Number(form.creditLimit) || 0,
        defaultPriceTier: form.defaultPriceTier,
        openingBalance: Number(form.openingBalance) || 0,
        category: "",
        status: "ACTIVE",
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="إضافة حساب جديد"
      description="الرصيد الافتتاحي: سالب = مديونية على الحساب، موجب = رصيد له."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} loading={pending} disabled={form.name.trim().length < 2}>
            <UserRound size={16} /> حفظ الحساب
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="اسم الحساب" required className="sm:col-span-2">
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="ورشة الشيخ زايد لصيانة BMW"
            />
          </Field>
          <Field label="نوع الحساب" required>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}>
              <option value="WORKSHOP_BMW">ورشة BMW</option>
              <option value="CUSTOMER">عميل</option>
              <option value="SUPPLIER">مورد</option>
              <option value="EXPENSE">مصروف</option>
            </Select>
          </Field>
          <Field label="شريحة السعر الافتراضية">
            <Select
              value={form.defaultPriceTier}
              onChange={(e) => setForm({ ...form, defaultPriceTier: e.target.value as "RETAIL" | "WHOLESALE" })}
            >
              <option value="WHOLESALE">جملة</option>
              <option value="RETAIL">قطاعي</option>
            </Select>
          </Field>
          <Field label="التليفون">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              dir="ltr"
              className="text-left"
            />
          </Field>
          <Field label="حد الائتمان" hint="صفر = لا يُسمح بالبيع الآجل">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
            />
          </Field>
          <Field label="الرصيد الافتتاحي" hint="سالب = عليه، موجب = له">
            <Input
              type="number"
              step="0.01"
              value={form.openingBalance}
              onChange={(e) => setForm({ ...form, openingBalance: e.target.value })}
            />
          </Field>
          <Field label="الرقم الضريبي">
            <Input value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Field label="العنوان" className="sm:col-span-2">
            <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function AddVehicleModal({
  account,
  options,
  onClose,
}: {
  account: AccountRow;
  options: AccountsClientProps["options"];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    vin: "",
    chassisId: "",
    engineId: "",
    modelYear: "",
    plateNumber: "",
    notes: "",
  });

  const vinClean = form.vin.trim().toUpperCase();
  const vinValid = /^[A-HJ-NPR-Z0-9]{17}$/.test(vinClean);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createVehicleAction({
        accountId: account.id,
        vin: vinClean,
        chassisId: form.chassisId,
        engineId: form.engineId,
        modelYear: form.modelYear ? Number(form.modelYear) : undefined,
        plateNumber: form.plateNumber,
        notes: form.notes,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`إضافة سيارة — ${account.name}`}
      description="رقم الشاسيه VIN من ١٧ خانة ولا يحتوي على الحروف I أو O أو Q."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} loading={pending} disabled={!vinValid}>
            <Car size={16} /> حفظ السيارة
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Field
          label="رقم الشاسيه (VIN)"
          required
          error={form.vin && !vinValid ? "رقم شاسيه غير صالح — ١٧ خانة بدون I/O/Q" : undefined}
          hint={`${vinClean.length}/17`}
        >
          <Input
            value={form.vin}
            onChange={(e) => setForm({ ...form, vin: e.target.value.toUpperCase() })}
            dir="ltr"
            className="text-left font-mono tracking-widest"
            maxLength={17}
            placeholder="WBA3B1C50EK123456"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="كود الشاسيه">
            <Select value={form.chassisId} onChange={(e) => setForm({ ...form, chassisId: e.target.value })}>
              <option value="">— غير محدد —</option>
              {options.chassis.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.series}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="كود المحرك">
            <Select value={form.engineId} onChange={(e) => setForm({ ...form, engineId: e.target.value })}>
              <option value="">— غير محدد —</option>
              {options.engines.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code}
                  {e.displacement ? ` — ${e.displacement}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="سنة الموديل">
            <Input
              type="number"
              min={1970}
              max={new Date().getFullYear() + 2}
              value={form.modelYear}
              onChange={(e) => setForm({ ...form, modelYear: e.target.value })}
            />
          </Field>
          <Field label="رقم اللوحة">
            <Input value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value })} />
          </Field>
        </div>
        <Field label="ملاحظات">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

/** Edit an existing account. Previously accounts were write-once from the UI. */
function EditAccountModal({ account, onClose }: { account: AccountRow; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: account.name,
    type: account.type,
    phone: account.phone ?? "",
    email: account.email ?? "",
    address: "",
    taxNumber: account.taxNumber ?? "",
    creditLimit: String(account.creditLimit),
    defaultPriceTier: (account.defaultPriceTier === "WHOLESALE" ? "WHOLESALE" : "RETAIL") as
      | "RETAIL"
      | "WHOLESALE",
    isActive: account.isActive,
  });

  const newLimit = Number(form.creditLimit) || 0;
  const limitBelowDebt = account.debt > 0 && account.debt > newLimit;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateAccountAction({
        id: account.id,
        name: form.name,
        type: form.type,
        phone: form.phone,
        email: form.email,
        address: form.address,
        taxNumber: form.taxNumber,
        creditLimit: newLimit,
        defaultPriceTier: form.defaultPriceTier,
        category: "",
        status: form.isActive ? "ACTIVE" : "INACTIVE",
        isActive: form.isActive,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`تعديل الحساب — ${account.name}`}
      description={`${account.accountNumber} • الرصيد ${formatMoney(account.currentBalance)} ${CURRENCY}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} loading={pending} disabled={form.name.trim().length < 2 || limitBelowDebt}>
            حفظ التعديلات
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {limitBelowDebt ? (
          <Alert variant="warning">
            حد الائتمان الجديد ({formatMoney(newLimit)}) أقل من المديونية الحالية (
            {formatMoney(account.debt)}). سدّد الرصيد أولاً.
          </Alert>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="اسم الحساب" required className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="نوع الحساب" required>
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })}>
              <option value="WORKSHOP_BMW">ورشة BMW</option>
              <option value="CUSTOMER">عميل</option>
              <option value="SUPPLIER">مورد</option>
              <option value="EXPENSE">مصروف</option>
            </Select>
          </Field>
          <Field label="شريحة السعر">
            <Select
              value={form.defaultPriceTier}
              onChange={(e) => setForm({ ...form, defaultPriceTier: e.target.value as "RETAIL" | "WHOLESALE" })}
            >
              <option value="WHOLESALE">جملة</option>
              <option value="RETAIL">قطاعي</option>
            </Select>
          </Field>
          <Field label="التليفون">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              dir="ltr"
              className="text-left"
            />
          </Field>
          <Field label="حد الائتمان" hint="صفر = لا يُسمح بالبيع الآجل">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.creditLimit}
              onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
            />
          </Field>
          <Field label="الرقم الضريبي">
            <Input value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })} dir="ltr" className="text-left" />
          </Field>
          <Field label="العنوان" className="sm:col-span-2">
            <Textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-bmw-silver">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            className="accent-bmw-blue"
          />
          الحساب نشط
        </label>
        {!form.isActive && account.currentBalance !== 0 ? (
          <Alert variant="warning">لا يمكن إيقاف حساب له رصيد مفتوح.</Alert>
        ) : null}
      </div>
    </Modal>
  );
}

interface StatementData {
  account: { id: string; name: string; accountNumber: string; currentBalance: number; creditLimit: number };
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    type: keyof typeof LABELS.invoiceType;
    grandTotal: number;
    paidAmount: number;
    remainingAmount: number;
    paymentStatus: keyof typeof LABELS.paymentStatus;
    isVoided: boolean;
    createdAt: string;
  }>;
  transactions: Array<{
    id: string;
    transactionNumber: string;
    type: keyof typeof LABELS.transactionType;
    amount: number;
    description: string;
    treasuryName: string;
    createdAt: string;
  }>;
}

/** Account statement — the drill-down behind a receivable balance. */
function StatementModal({ account, onClose }: { account: AccountRow; onClose: () => void }) {
  const [data, setData] = useState<StatementData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAccountStatementAction(account.id).then((res) => {
      if (cancelled) return;
      if (res.success) setData(res.data as StatementData);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`كشف حساب — ${account.name}`}
      description={`${account.accountNumber} • الرصيد ${formatMoney(account.currentBalance)} ${CURRENCY} ${
        account.currentBalance < 0 ? "(عليه)" : account.currentBalance > 0 ? "(له)" : ""
      }`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إغلاق
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            طباعة
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {data === null && !error ? <p className="text-xs text-bmw-muted">جاري التحميل…</p> : null}

        {data ? (
          <>
            <div>
              <h3 className="mb-2 text-xs font-bold text-bmw-blue">الفواتير</h3>
              <Table>
                <THead>
                  <TR>
                    <TH>رقم الفاتورة</TH>
                    <TH>النوع</TH>
                    <TH>الإجمالي</TH>
                    <TH>المدفوع</TH>
                    <TH>المتبقي</TH>
                    <TH>الحالة</TH>
                    <TH>التاريخ</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.invoices.length === 0 ? (
                    <EmptyState colSpan={7} title="لا توجد فواتير" />
                  ) : (
                    data.invoices.map((i) => (
                      <TR key={i.id} className={i.isVoided ? "opacity-50" : undefined}>
                        <TD className="tabular text-xs font-bold text-white">{i.invoiceNumber}</TD>
                        <TD className="text-xs">{LABELS.invoiceType[i.type]}</TD>
                        <TD className="tabular text-xs font-bold">{formatMoney(i.grandTotal)}</TD>
                        <TD className="tabular text-xs text-emerald-400">{formatMoney(i.paidAmount)}</TD>
                        <TD className="tabular text-xs text-amber-400">{formatMoney(i.remainingAmount)}</TD>
                        <TD>
                          {i.isVoided ? (
                            <Badge variant="danger">ملغاة</Badge>
                          ) : (
                            <Badge variant={i.paymentStatus === "PAID" ? "success" : "warning"}>
                              {LABELS.paymentStatus[i.paymentStatus]}
                            </Badge>
                          )}
                        </TD>
                        <TD className="tabular text-xs text-bmw-muted">{formatDateTime(i.createdAt)}</TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-bold text-bmw-blue">الحركات المالية</h3>
              <Table>
                <THead>
                  <TR>
                    <TH>رقم السند</TH>
                    <TH>النوع</TH>
                    <TH>المبلغ</TH>
                    <TH>الخزينة</TH>
                    <TH>البيان</TH>
                    <TH>التاريخ</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.transactions.length === 0 ? (
                    <EmptyState colSpan={6} title="لا توجد حركات" />
                  ) : (
                    data.transactions.map((t) => (
                      <TR key={t.id}>
                        <TD className="tabular text-xs font-bold text-white">{t.transactionNumber}</TD>
                        <TD>
                          <Badge variant={t.type === "RECEIPT" ? "success" : "danger"}>
                            {LABELS.transactionType[t.type]}
                          </Badge>
                        </TD>
                        <TD className="tabular text-xs font-bold">{formatMoney(t.amount)}</TD>
                        <TD className="text-xs">{t.treasuryName}</TD>
                        <TD className="max-w-[220px] truncate text-xs text-bmw-muted">{t.description}</TD>
                        <TD className="tabular text-xs text-bmw-muted">{formatDateTime(t.createdAt)}</TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

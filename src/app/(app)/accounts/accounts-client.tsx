"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Car, Download, FileText, Pencil, Plus, Printer, ScrollText, Search, UserRound, Users, Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ARABIC_LABELS, CURRENCY, formatDateTime, formatInt, formatMoney } from "@/lib/utils";
import type { AccountRow } from "@/server/services/accounts.service";
import { createAccountAction, createVehicleAction, updateAccountAction } from "@/server/actions/accounts.actions";
import { createTreasuryTransactionAction } from "@/server/actions/treasury.actions";
import { getAccountDetailedLedgerAction, getAccountPdcInstallmentsAction } from "@/server/actions/invoices.read.actions";
import { AccountStatementTemplate, type AccountStatementPrintData } from "@/components/print/templates/AccountStatementTemplate";
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
  companyName: string;
  canTransact: boolean;
  treasuries: Array<{ id: string; name: string; currentBalance: number }>;
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
  companyName,
  canTransact,
  treasuries,
  totals,
}: AccountsClientProps) {
  const router = useRouter();
  const [query, setQuery] = useState(filters.query);
  const [addOpen, setAddOpen] = useState(false);
  const [vehicleFor, setVehicleFor] = useState<AccountRow | null>(null);
  const [editAccount, setEditAccount] = useState<AccountRow | null>(null);
  const [statementFor, setStatementFor] = useState<AccountRow | null>(null);
  const [voucherFor, setVoucherFor] = useState<{ account: AccountRow; type: "RECEIPT" | "PAYMENT" } | null>(null);
  const [pdcFor, setPdcFor] = useState<AccountRow | null>(null);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const displayedDebit = rows.filter((account) => account.currentBalance < 0).reduce((sum, account) => sum + Math.abs(account.currentBalance), 0);
  const displayedCredit = rows.filter((account) => account.currentBalance > 0).reduce((sum, account) => sum + account.currentBalance, 0);

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
                <TR key={account.id} tabIndex={0} onDoubleClick={() => setStatementFor(account)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setStatementFor(account); } }} className={`${account.isActive ? "" : "opacity-50"} cursor-pointer focus:outline-none focus:ring-1 focus:ring-bmw-blue`}>
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
                      {canTransact && account.type !== "EXPENSE" ? <button type="button" onClick={() => setVoucherFor({ account, type: "RECEIPT" })} title="سند قبض" className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-emerald-500/10 hover:text-emerald-400"><ArrowDownLeft size={15} /></button> : null}
                      {canTransact && account.type !== "EXPENSE" ? <button type="button" onClick={() => setVoucherFor({ account, type: "PAYMENT" })} title="سند صرف" className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-bmw-mRed/10 hover:text-bmw-mRed"><ArrowUpRight size={15} /></button> : null}
                      {canViewStatement ? <button type="button" onClick={() => setPdcFor(account)} title="الشيكات والأقساط" className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-amber-500/10 hover:text-amber-400"><ScrollText size={15} /></button> : null}
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

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-bmw-cardBorder bg-bmw-card/95 px-4 py-3 text-xs backdrop-blur"><span className="text-bmw-muted">إجمالي الأرصدة المعروضة</span><div className="flex gap-4"><span className="tabular text-bmw-mRed">مدين / عليه: <b>{formatMoney(displayedDebit)} {CURRENCY}</b></span><span className="tabular text-emerald-400">دائن / له: <b>{formatMoney(displayedCredit)} {CURRENCY}</b></span></div></div>

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
        <StatementModal key={statementFor.id} account={statementFor} companyName={companyName} onClose={() => setStatementFor(null)} />
      ) : null}
      {voucherFor ? <AccountVoucherModal account={voucherFor.account} type={voucherFor.type} treasuries={treasuries} onClose={() => setVoucherFor(null)} /> : null}
      {pdcFor ? <AccountPdcModal account={pdcFor} onClose={() => setPdcFor(null)} /> : null}
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

const DEFAULT_ACCOUNT_FORM = { name: "", type: "CUSTOMER" as "CUSTOMER" | "WORKSHOP_BMW" | "SUPPLIER" | "EXPENSE", phone: "", email: "", address: "", taxNumber: "", creditLimit: "0", defaultPriceTier: "RETAIL" as "RETAIL" | "WHOLESALE", openingBalance: "0" };

function AddAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(DEFAULT_ACCOUNT_FORM);
  const reset = () => { setForm(DEFAULT_ACCOUNT_FORM); setError(null); };
  const close = () => { reset(); onClose(); };
  useEffect(() => { reset(); }, [open]);

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
      reset();
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="إضافة حساب جديد"
      description="الرصيد الافتتاحي: سالب = مديونية على الحساب، موجب = رصيد له."
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={pending}>
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
              autoFocus
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
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="رقم الهاتف (اختياري)" dir="ltr" className="text-left" />
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
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="رقم الهاتف (اختياري)" dir="ltr" className="text-left" />
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

interface DetailedLedgerData {
  account: { id: string; name: string; accountNumber: string; phone: string | null; currentBalance: number; creditLimit: number };
  filters: { from: string | null; to: string | null };
  openingBalance: number;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
  rows: Array<{ id: string; createdAt: string; reference: string; type: string; typeLabel: string; debit: number; credit: number; runningBalance: number; treasuryName: string | null; note: string | null; documentKind: "INVOICE" | "TREASURY_TRANSACTION"; invoiceId: string | null }>;
}

function StatementModal({ account, companyName, onClose }: { account: AccountRow; companyName: string; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<DetailedLedgerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [movementType, setMovementType] = useState("ALL");
  const [query, setQuery] = useState("");
  const [printRequested, setPrintRequested] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void getAccountDetailedLedgerAction(account.id, { from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined, movementTypes: movementType === "ALL" ? undefined : [movementType], query: query || undefined }).then((result) => {
      if (cancelled) return;
      if (result.success) setData(result.data as DetailedLedgerData);
      else setError(result.error);
    });
    return () => { cancelled = true; };
  }, [account.id, from, to, movementType, query]);

  useEffect(() => {
    if (!printRequested) return;
    const done = () => setPrintRequested(false);
    window.addEventListener("afterprint", done);
    const timer = window.setTimeout(() => window.print(), 60);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, [printRequested]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [["التاريخ", "المرجع", "النوع", "مدين", "دائن", "الرصيد", "الخزينة", "البيان"], ...data.rows.map((row) => [formatDateTime(row.createdAt), row.reference, row.typeLabel, String(row.debit), String(row.credit), String(row.runningBalance), row.treasuryName ?? "", row.note ?? ""])];
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `كشف-حساب-${data.account.accountNumber}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const printData: AccountStatementPrintData | null = data ? { companyName, accountName: data.account.name, accountNumber: data.account.accountNumber, phone: data.account.phone, from: data.filters.from ?? undefined, to: data.filters.to ?? undefined, openingBalance: data.openingBalance, debit: data.totalDebit, credit: data.totalCredit, closingBalance: data.closingBalance, rows: data.rows.map((row) => ({ id: row.id, createdAt: row.createdAt, reference: row.reference, type: row.typeLabel, debit: row.debit, credit: row.credit, runningBalance: row.runningBalance, treasury: row.treasuryName, note: row.note })) } : null;

  return <>
    <Modal open onClose={onClose} title={`كشف حساب تفصيلي — ${account.name}`} description={`${account.accountNumber} • الرصيد الحالي ${formatMoney(account.currentBalance)} ${CURRENCY}`} size="xl" footer={<><Button variant="ghost" onClick={onClose}>إغلاق</Button><Button variant="outline" onClick={exportCsv} disabled={!data}><Download size={15} /> تصدير CSV</Button><Button variant="outline" onClick={() => setPrintRequested(true)} disabled={!printData}><Printer size={15} /> طباعة A4</Button></>}>
      <div className="space-y-4">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {!data && !error ? <p className="text-xs text-bmw-muted">جاري تحميل دفتر الأستاذ…</p> : null}
        <div className="grid gap-2 sm:grid-cols-4"><Field label="من"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field><Field label="إلى"><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field><Field label="نوع الحركة"><Select value={movementType} onChange={(event) => setMovementType(event.target.value)}><option value="ALL">كل الحركات</option><option value="SALE">فواتير بيع</option><option value="PURCHASE">فواتير شراء</option><option value="SALE_RETURN">مرتجع بيع</option><option value="PURCHASE_RETURN">مرتجع شراء</option><option value="RECEIPT">سند قبض</option><option value="PAYMENT">سند صرف</option></Select></Field><Field label="بحث"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="مرجع أو بيان" /></Field></div>
        {data ? <><div className="grid gap-2 sm:grid-cols-4"><StatementKpi label="رصيد افتتاحي" value={data.openingBalance} /><StatementKpi label="إجمالي مدين" value={data.totalDebit} tone="text-bmw-mRed" /><StatementKpi label="إجمالي دائن" value={data.totalCredit} tone="text-emerald-400" /><StatementKpi label="رصيد ختامي" value={data.closingBalance} tone="text-bmw-blue" /></div><Table><THead><TR><TH>التاريخ والوقت</TH><TH>المرجع</TH><TH>الحركة</TH><TH>مدين</TH><TH>دائن</TH><TH>الرصيد المتراكم</TH><TH>الخزينة</TH><TH>البيان</TH></TR></THead><TBody>{data.rows.length === 0 ? <EmptyState colSpan={8} title="لا توجد حركات وفق الفلاتر المحددة" /> : data.rows.map((row) => <TR key={row.id}><TD className="tabular whitespace-nowrap text-xs text-bmw-muted">{formatDateTime(row.createdAt)}</TD><TD><button type="button" className="font-mono text-xs font-bold text-bmw-blue hover:underline" onClick={() => row.documentKind === "INVOICE" ? router.push(`/invoices?q=${encodeURIComponent(row.reference)}`) : undefined}>{row.reference}</button></TD><TD><Badge variant={row.credit > 0 ? "success" : row.debit > 0 ? "danger" : "default"}>{row.typeLabel}</Badge></TD><TD className="tabular text-bmw-mRed">{row.debit ? formatMoney(row.debit) : "—"}</TD><TD className="tabular text-emerald-400">{row.credit ? formatMoney(row.credit) : "—"}</TD><TD><span className="rounded-full bg-bmw-blue/15 px-2 py-1 font-mono text-xs font-bold text-bmw-blue">{formatMoney(row.runningBalance)}</span></TD><TD className="text-xs">{row.treasuryName ?? "—"}</TD><TD className="max-w-[180px] truncate text-xs text-bmw-muted">{row.note ?? "—"}</TD></TR>)}</TBody></Table></> : null}
      </div>
    </Modal>
    {printRequested && printData ? <AccountStatementTemplate data={printData} /> : null}
  </>;
}

function StatementKpi({ label, value, tone = "text-white" }: { label: string; value: number; tone?: string }) {
  return <div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3"><p className="text-[11px] text-bmw-muted">{label}</p><p className={`tabular mt-1 text-sm font-bold ${tone}`}>{formatMoney(value)} <span className="text-[10px] text-bmw-muted">{CURRENCY}</span></p></div>;
}

function AccountVoucherModal({ account, type, treasuries, onClose }: { account: AccountRow; type: "RECEIPT" | "PAYMENT"; treasuries: Array<{ id: string; name: string; currentBalance: number }>; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [treasuryId, setTreasuryId] = useState(treasuries[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const parsed = Number(amount) || 0;
  const selectedTreasury = treasuries.find((treasury) => treasury.id === treasuryId);
  const insufficient = type === "PAYMENT" && !!selectedTreasury && parsed > selectedTreasury.currentBalance;
  const submit = () => { setError(null); startTransition(async () => { const result = await createTreasuryTransactionAction({ treasuryId, accountId: account.id, type, amount: parsed, description: description || `${type === "RECEIPT" ? "تحصيل من" : "سداد إلى"} ${account.name}` }); if (!result.success) { setError(result.error); return; } onClose(); router.refresh(); }); };
  return <Modal open onClose={onClose} title={type === "RECEIPT" ? `سند قبض — ${account.name}` : `سند صرف — ${account.name}`} description={type === "RECEIPT" ? "يُسجّل القبض في الخزينة ويخفض مديونية الحساب." : "يُسجّل الصرف من الخزينة ويخفض مستحقات الحساب."} size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button><Button variant={type === "RECEIPT" ? "success" : "danger"} onClick={submit} loading={pending} disabled={!treasuryId || parsed <= 0 || insufficient}>تسجيل السند</Button></>}>
    <div className="space-y-3">
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Alert variant="info">الرصيد الحالي: <strong>{formatMoney(Math.abs(account.currentBalance))} {CURRENCY}</strong> {account.currentBalance < 0 ? "(عليه)" : account.currentBalance > 0 ? "(له)" : ""}</Alert>
      <Field label="الخزينة" required><Select value={treasuryId} onChange={(event) => setTreasuryId(event.target.value)}><option value="">اختر الخزينة</option>{treasuries.map((treasury) => <option key={treasury.id} value={treasury.id}>{treasury.name} — {formatMoney(treasury.currentBalance)} {CURRENCY}</option>)}</Select></Field>
      <Field label="المبلغ" required error={insufficient ? `السيولة المتاحة ${formatMoney(selectedTreasury!.currentBalance)} فقط` : undefined}><Input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} autoFocus dir="ltr" /></Field>
      <Field label="البيان"><Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={`${type === "RECEIPT" ? "تحصيل" : "سداد"} ${account.name}`} /></Field>
    </div>
  </Modal>;
}

function AccountPdcModal({ account, onClose }: { account: AccountRow; onClose: () => void }) {
  const [data, setData] = useState<{ checks: Array<{ id: string; direction: string; checkNumber: string; bankName: string | null; amount: number; issueDate: string | null; dueDate: string; status: string; notes: string | null }>; installmentPlans: Array<{ id: string; totalAmount: number; startDate: string; status: string; notes: string | null; installments: Array<{ id: string; dueDate: string; amount: number; paidAmount: number; status: string }> }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let cancelled = false; void getAccountPdcInstallmentsAction(account.id).then((result) => { if (cancelled) return; if (result.success) setData(result.data); else setError(result.error); }); return () => { cancelled = true; }; }, [account.id]);
  return <Modal open onClose={onClose} title={`الشيكات والأقساط — ${account.name}`} description="سجل الاستحقاقات وحالات التحصيل أو السداد المرتبطة بالحساب." size="lg" footer={<Button variant="ghost" onClick={onClose}>إغلاق</Button>}><div className="space-y-5">{error ? <Alert variant="error">{error}</Alert> : null}{!data && !error ? <p className="text-xs text-bmw-muted">جاري تحميل السجل…</p> : null}{data ? <><section><h3 className="mb-2 text-sm font-bold text-bmw-blue">سجل الشيكات</h3><Table><THead><TR><TH>الاتجاه</TH><TH>رقم الشيك</TH><TH>البنك</TH><TH>القيمة</TH><TH>الاستحقاق</TH><TH>الحالة</TH><TH>ملاحظات</TH></TR></THead><TBody>{data.checks.length ? data.checks.map((check) => <TR key={check.id}><TD><Badge variant={check.direction === "RECEIVABLE" ? "success" : "danger"}>{check.direction === "RECEIVABLE" ? "وارد" : "صادر"}</Badge></TD><TD className="font-mono text-xs">{check.checkNumber}</TD><TD className="text-xs">{check.bankName ?? "—"}</TD><TD className="tabular">{formatMoney(check.amount)}</TD><TD className="tabular text-xs">{formatDateTime(check.dueDate)}</TD><TD><Badge variant={check.status === "CLEARED" ? "success" : check.status === "BOUNCED" ? "danger" : "warning"}>{check.status}</Badge></TD><TD className="max-w-[180px] truncate text-xs text-bmw-muted">{check.notes ?? "—"}</TD></TR>) : <EmptyState colSpan={7} title="لا توجد شيكات مرتبطة" />}</TBody></Table></section><section><h3 className="mb-2 text-sm font-bold text-bmw-blue">خطط الأقساط</h3>{data.installmentPlans.length ? <div className="space-y-3">{data.installmentPlans.map((plan) => <div key={plan.id} className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs text-bmw-muted">بدأت {formatDateTime(plan.startDate)}</span><span className="tabular font-bold">{formatMoney(plan.totalAmount)} {CURRENCY}</span><Badge variant={plan.status === "PAID" ? "success" : "warning"}>{plan.status}</Badge></div><Table><THead><TR><TH>تاريخ الاستحقاق</TH><TH>القيمة</TH><TH>المسدد</TH><TH>الحالة</TH></TR></THead><TBody>{plan.installments.map((installment) => <TR key={installment.id}><TD className="tabular text-xs">{formatDateTime(installment.dueDate)}</TD><TD className="tabular">{formatMoney(installment.amount)}</TD><TD className="tabular text-emerald-400">{formatMoney(installment.paidAmount)}</TD><TD><Badge variant={installment.status === "PAID" ? "success" : installment.status === "OVERDUE" ? "danger" : "warning"}>{installment.status}</Badge></TD></TR>)}</TBody></Table></div>)}</div> : <Alert variant="info">لا توجد خطط أقساط مرتبطة بهذا الحساب.</Alert>}</section></> : null}</div></Modal>;
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  Building2,
  CreditCard,
  FileText,
  Lock,
  Printer,
  Plus,
  Power,
  Settings2,
  Trash2,
  Unlock,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, KpiCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { UniversalDateTimePicker, type DateRangeValue } from "@/components/ui/universal-date-time-picker";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { SelectionActionToolbar } from "@/components/ui/selection-action-toolbar";
import { ARABIC_LABELS, CURRENCY, formatDateTime, formatMoney } from "@/lib/utils";
import type { TreasuryRow } from "@/server/services/treasury.service";
import {
  closeShiftAction,
  createTreasuryAction,
  createTreasuryTransactionAction,
  deleteTreasuryAction,
  openShiftAction,
  transferBetweenTreasuriesAction,
  toggleTreasuryStatusAction,
  updateTreasuryAction,
  deleteManualTreasuryTransactionsAction,
} from "@/server/actions/treasury.actions";

interface ZReport {
  treasury: { id: string; name: string; type: string; currentBalance: number };
  shift: {
    id: string;
    shiftNumber: string;
    openingBalance: number;
    bookOpeningBalance: number;
    openedAt: string;
    openedBy: string;
  } | null;
  periodStart: string;
  receipts: number;
  payments: number;
  transfers: number;
  /** Book balance at period start — snapshotted at shift open, not typed in. */
  openingBalance: number;
  expectedBalance: number;
  invoiceCount: number;
  byPaymentMethod: Array<{ method: string; count: number; total: number; collected: number }>;
}

interface TransactionRow {
  id: string;
  transactionNumber: string;
  type: "RECEIPT" | "PAYMENT" | "TRANSFER";
  amount: number;
  description: string;
  treasuryName: string;
  accountName: string | null;
  invoiceNumber: string | null;
  createdAt: string;
}

interface ClosedShift {
  id: string;
  shiftNumber: string;
  treasuryName: string;
  openedBy: string;
  openingBalance: number;
  closingBalance: number;
  countedCash: number;
  varianceAmount: number;
  openedAt: string;
  closedAt: string | null;
}

interface TreasuryClientProps {
  treasuries: TreasuryRow[];
  transactions: TransactionRow[];
  closedShifts: ClosedShift[];
  zReport: ZReport | null;
  accounts: Array<{ id: string; name: string; accountNumber: string; type: string }>;
  permissions: { canTransact: boolean; canTransfer: boolean; canCloseShift: boolean; canManage: boolean };
  initialVoucher: "RECEIPT" | "PAYMENT" | null;
}

const initialTreasuryRange = (): DateRangeValue => { const now = new Date(); const from = new Date(now); from.setHours(0, 0, 0, 0); const iso = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); return { from: iso(from), to: iso(now), preset: "TODAY", pinned: false }; };

const TYPE_ICON: Record<string, typeof Wallet> = {
  CASH_DRAWER: Banknote,
  BANK_ACCOUNT: Building2,
  POS_TERMINAL: CreditCard,
  WALLET: Wallet,
};

export function TreasuryClient({
  treasuries,
  transactions,
  closedShifts,
  zReport,
  accounts,
  permissions,
  initialVoucher,
}: TreasuryClientProps) {
  const router = useRouter();
  const [voucher, setVoucher] = useState<"RECEIPT" | "PAYMENT" | null>(initialVoucher);
  const [transferOpen, setTransferOpen] = useState(false);
  const [shiftAction, setShiftAction] = useState<{ mode: "open" | "close"; treasury: TreasuryRow } | null>(null);
  const [manageTreasury, setManageTreasury] = useState<TreasuryRow | "NEW" | null>(null);
  const [deleteTreasury, setDeleteTreasury] = useState<TreasuryRow | null>(null);
  const [treasuryActionError, setTreasuryActionError] = useState<string | null>(null);
  const [statusPending, startStatusTransition] = useTransition();
  const [range, setRange] = useState<DateRangeValue>(initialTreasuryRange);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<string[]>([]);
  const [deleteTransactionsOpen, setDeleteTransactionsOpen] = useState(false);

  useEffect(() => setVoucher(initialVoucher), [initialVoucher]);

  const totalLiquidity = treasuries.reduce((s, t) => s + t.currentBalance, 0);
  const cashOnHand = treasuries.filter((t) => t.type === "CASH_DRAWER").reduce((s, t) => s + t.currentBalance, 0);
  const todayIn = treasuries.reduce((s, t) => s + t.todayIn, 0);
  const todayOut = treasuries.reduce((s, t) => s + t.todayOut, 0);
  const filteredTransactions = transactions.filter((transaction) => { const at = new Date(transaction.createdAt).getTime(); return at >= new Date(range.from).getTime() && at <= new Date(range.to).getTime(); });
  const selectableTransactions = filteredTransactions.filter((transaction) => !transaction.invoiceNumber && transaction.type !== "TRANSFER");
  const selectedTransactions = selectableTransactions.filter((transaction) => selectedTransactionIds.includes(transaction.id));
  const toggleStatus = (treasury: TreasuryRow) => {
    setTreasuryActionError(null);
    startStatusTransition(async () => {
      const result = await toggleTreasuryStatusAction(treasury.id);
      if (!result.success) { setTreasuryActionError(result.error); return; }
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue">
            <Wallet size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">الخزينة والسيولة</h1>
            <p className="text-xs text-bmw-muted">سندات القبض والصرف، التحويلات الداخلية، وتقرير Z للوردية</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.canTransact ? (
            <>
              <Button variant="success" onClick={() => setVoucher("RECEIPT")}>
                <ArrowDownLeft size={16} /> سند قبض
              </Button>
              <Button variant="danger" onClick={() => setVoucher("PAYMENT")}>
                <ArrowUpRight size={16} /> سند صرف
              </Button>
            </>
          ) : null}
          {permissions.canTransfer ? (
            <Button variant="outline" onClick={() => setTransferOpen(true)}>
              <ArrowLeftRight size={16} /> تحويل داخلي
            </Button>
          ) : null}
          {permissions.canManage ? <Button variant="outline" onClick={() => setManageTreasury("NEW")}><Plus size={16} /> إنشاء خزينة جديدة</Button> : null}
        </div>
      </div>

      {treasuryActionError ? <Alert variant="error">{treasuryActionError}</Alert> : null}

      <UniversalDateTimePicker value={range} onChange={setRange} syncToUrl storageKey="bimmererp:treasury-range" />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="إجمالي السيولة" value={formatMoney(totalLiquidity)} unit={CURRENCY} accent="blue" />
        <KpiCard label="نقدية الأدراج" value={formatMoney(cashOnHand)} unit={CURRENCY} accent="green" />
        <KpiCard label="مقبوضات اليوم" value={formatMoney(todayIn)} unit={CURRENCY} accent="green" />
        <KpiCard label="مدفوعات اليوم" value={formatMoney(todayOut)} unit={CURRENCY} accent="red" />
      </div>

      {/* Treasuries */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {treasuries.map((treasury) => {
          const Icon = TYPE_ICON[treasury.type] ?? Wallet;
          return (
            <Card key={treasury.id} className={treasury.isActive ? undefined : "opacity-60"}>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-2 text-bmw-blue">
                      <Icon size={18} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{treasury.name}</p>
                      <p className="text-[10px] text-bmw-muted">
                        {ARABIC_LABELS.treasuryType[treasury.type]}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Badge variant={treasury.isActive ? "success" : "muted"}>{treasury.isActive ? "نشطة" : "معطلة"}</Badge>
                    {treasury.isDefault ? <Badge variant="blue">افتراضية</Badge> : null}
                    {treasury.openShift ? (
                      <Badge variant="success" mono>
                        {treasury.openShift.shiftNumber}
                      </Badge>
                    ) : (
                      <Badge variant="muted">مغلقة</Badge>
                    )}
                  </div>
                </div>

                {treasury.notes ? <p className="min-h-4 text-[11px] text-bmw-muted">{treasury.notes}</p> : null}

                <p className="tabular text-2xl font-bold text-white">
                  {formatMoney(treasury.currentBalance)}
                  <span className="mr-1 text-xs font-normal text-bmw-muted">{CURRENCY}</span>
                </p>

                <div className="flex gap-3 text-[11px]">
                  <span className="tabular text-emerald-400">▲ {formatMoney(treasury.todayIn)}</span>
                  <span className="tabular text-bmw-mRed">▼ {formatMoney(treasury.todayOut)}</span>
                </div>

                {permissions.canManage ? <div className="grid grid-cols-3 gap-2 border-t border-bmw-cardBorder pt-3"><Button size="sm" variant="ghost" onClick={() => setManageTreasury(treasury)}><Settings2 size={14} /> تعديل</Button><Button size="sm" variant="ghost" onClick={() => toggleStatus(treasury)} disabled={statusPending} title={treasury.isActive ? "تعطيل الخزينة" : "تنشيط الخزينة"}><Power size={14} /> {treasury.isActive ? "تعطيل" : "تنشيط"}</Button><Button size="sm" variant="ghost" className="text-bmw-mRed hover:bg-bmw-mRed/10 hover:text-bmw-mRed" onClick={() => setDeleteTreasury(treasury)} title="حذف الخزينة بعد فحص الرصيد والسجل"><Trash2 size={14} /> حذف</Button></div> : null}

                {permissions.canCloseShift && treasury.isActive ? (
                  <div className="border-t border-bmw-cardBorder pt-3">
                    {treasury.openShift ? (
                      <div className="space-y-2">
                        <p className="text-[10px] text-bmw-muted">
                          فتحها {treasury.openShift.openedBy} — {formatDateTime(treasury.openShift.openedAt)}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={() => setShiftAction({ mode: "close", treasury })}
                        >
                          <Lock size={14} /> إغلاق الوردية (تقرير Z)
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => setShiftAction({ mode: "open", treasury })}
                      >
                        <Unlock size={14} /> فتح وردية
                      </Button>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Z-Report */}
      {zReport ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <FileText size={18} className="text-bmw-blue" /> تقرير Z — {zReport.treasury.name}
            </CardTitle>
            <div className="flex items-center gap-2">
              {zReport.shift ? (
                <Badge variant="blue" mono>
                  {zReport.shift.shiftNumber}
                </Badge>
              ) : (
                <Badge variant="muted">من بداية اليوم</Badge>
              )}
              <Button size="sm" variant="ghost" onClick={() => window.print()}>
                <Printer size={14} /> طباعة
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2 text-sm">
              <Row label="الرصيد الدفتري في بداية الفترة" value={formatMoney(zReport.openingBalance)} />
              {zReport.shift && zReport.shift.openingBalance !== zReport.shift.bookOpeningBalance ? (
                <Row
                  label="الرصيد المعلن من الكاشير"
                  value={formatMoney(zReport.shift.openingBalance)}
                  tone="text-amber-400"
                />
              ) : null}
              <Row label="إجمالي المقبوضات" value={formatMoney(zReport.receipts)} tone="text-emerald-400" />
              <Row label="إجمالي المدفوعات" value={formatMoney(zReport.payments)} tone="text-bmw-mRed" />
              <Row label="صافي التحويلات" value={formatMoney(zReport.transfers)} />
              <div className="border-t border-bmw-cardBorder pt-2">
                <Row label="الرصيد المتوقع" value={formatMoney(zReport.expectedBalance)} bold />
                <Row label="الرصيد الدفتري الفعلي" value={formatMoney(zReport.treasury.currentBalance)} bold />
                <Row
                  label="فرق المطابقة الدفترية"
                  value={formatMoney(zReport.treasury.currentBalance - zReport.expectedBalance)}
                  tone={
                    Math.abs(zReport.treasury.currentBalance - zReport.expectedBalance) < 0.01
                      ? "text-emerald-400"
                      : "text-bmw-mRed"
                  }
                  bold
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-bold text-bmw-silver">
                التفصيل حسب طريقة الدفع ({zReport.invoiceCount} فاتورة)
              </p>
              {zReport.byPaymentMethod.length === 0 ? (
                <p className="text-xs text-bmw-muted">لا توجد فواتير في هذه الفترة.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>الطريقة</TH>
                      <TH>العدد</TH>
                      <TH>الإجمالي</TH>
                      <TH>المحصّل</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {zReport.byPaymentMethod.map((m) => (
                      <TR key={m.method}>
                        <TD className="text-xs">
                          {ARABIC_LABELS.paymentMethod[m.method as keyof typeof ARABIC_LABELS.paymentMethod] ??
                            m.method}
                        </TD>
                        <TD className="tabular text-xs">{m.count}</TD>
                        <TD className="tabular text-xs font-bold">{formatMoney(m.total)}</TD>
                        <TD className="tabular text-xs text-emerald-400">{formatMoney(m.collected)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Movements */}
      <SelectionActionToolbar count={selectedTransactions.length} itemLabel="سند" onDelete={permissions.canManage ? () => setDeleteTransactionsOpen(true) : undefined} deleteLabel="حذف وعكس السندات" onClear={() => setSelectedTransactionIds([])} />
      <Card>
        <CardHeader>
          <CardTitle>آخر الحركات المالية</CardTitle>
        </CardHeader>
        <Table>
          <THead>
            <TR>
              <TH><input aria-label="تحديد كل السندات اليدوية" type="checkbox" checked={selectableTransactions.length > 0 && selectableTransactions.every((transaction) => selectedTransactionIds.includes(transaction.id))} onChange={(event) => setSelectedTransactionIds(event.target.checked ? selectableTransactions.map((transaction) => transaction.id) : [])} /></TH>
              <TH>رقم السند</TH>
              <TH>النوع</TH>
              <TH>الخزينة</TH>
              <TH>الحساب</TH>
              <TH>البيان</TH>
              <TH>الفاتورة</TH>
              <TH>المبلغ</TH>
              <TH>التاريخ</TH>
            </TR>
          </THead>
          <TBody>
            {filteredTransactions.length === 0 ? (
              <EmptyState colSpan={9} title="لا توجد حركات مالية" icon={<Wallet size={32} />} />
            ) : (
              filteredTransactions.map((t) => (
                <TR key={t.id}><TD><input aria-label={`تحديد السند ${t.transactionNumber}`} type="checkbox" disabled={Boolean(t.invoiceNumber) || t.type === "TRANSFER"} className={t.invoiceNumber || t.type === "TRANSFER" ? "cursor-not-allowed opacity-35" : undefined} checked={selectedTransactionIds.includes(t.id)} onChange={(event) => setSelectedTransactionIds((current) => event.target.checked ? [...new Set([...current, t.id])] : current.filter((id) => id !== t.id))} /></TD>
                  <TD className="tabular whitespace-nowrap text-xs font-bold text-white">{t.transactionNumber}</TD>
                  <TD>
                    <Badge
                      variant={t.type === "RECEIPT" ? "success" : t.type === "PAYMENT" ? "danger" : "blue"}
                    >
                      {ARABIC_LABELS.transactionType[t.type]}
                    </Badge>
                  </TD>
                  <TD className="text-xs">{t.treasuryName}</TD>
                  <TD className="max-w-[160px] truncate text-xs">{t.accountName ?? "—"}</TD>
                  <TD className="max-w-[240px] truncate text-xs text-bmw-muted">{t.description}</TD>
                  <TD className="tabular text-xs text-bmw-blue">{t.invoiceNumber ?? "—"}</TD>
                  <TD
                    className={`tabular whitespace-nowrap font-bold ${
                      t.type === "RECEIPT" || t.amount > 0 ? "text-emerald-400" : "text-bmw-mRed"
                    }`}
                  >
                    {formatMoney(Math.abs(t.amount))}
                  </TD>
                  <TD className="tabular whitespace-nowrap text-xs text-bmw-muted">{formatDateTime(t.createdAt)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </Card>

      {deleteTransactionsOpen ? <DeleteManualTreasuryTransactionsModal transactions={selectedTransactions} onClose={() => setDeleteTransactionsOpen(false)} onDone={() => { setDeleteTransactionsOpen(false); setSelectedTransactionIds([]); router.refresh(); }} /> : null}

      {/* Closed shifts */}
      {closedShifts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>ورديات مغلقة</CardTitle>
          </CardHeader>
          <Table>
            <THead>
              <TR>
                <TH>رقم الوردية</TH>
                <TH>الخزينة</TH>
                <TH>المستخدم</TH>
                <TH>رصيد البداية</TH>
                <TH>الرصيد الدفتري</TH>
                <TH>النقدية المعدودة</TH>
                <TH>الفرق</TH>
                <TH>الإغلاق</TH>
              </TR>
            </THead>
            <TBody>
              {closedShifts.map((s) => (
                <TR key={s.id}>
                  <TD className="tabular text-xs font-bold text-white">{s.shiftNumber}</TD>
                  <TD className="text-xs">{s.treasuryName}</TD>
                  <TD className="text-xs text-bmw-muted">{s.openedBy}</TD>
                  <TD className="tabular text-xs">{formatMoney(s.openingBalance)}</TD>
                  <TD className="tabular text-xs">{formatMoney(s.closingBalance)}</TD>
                  <TD className="tabular text-xs">{formatMoney(s.countedCash)}</TD>
                  <TD
                    className={`tabular text-xs font-bold ${
                      Math.abs(s.varianceAmount) < 0.01
                        ? "text-emerald-400"
                        : s.varianceAmount > 0
                          ? "text-bmw-blue"
                          : "text-bmw-mRed"
                    }`}
                  >
                    {formatMoney(s.varianceAmount)}
                  </TD>
                  <TD className="tabular text-xs text-bmw-muted">
                    {s.closedAt ? formatDateTime(s.closedAt) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

      {voucher ? (
        <VoucherModal
          type={voucher}
          treasuries={treasuries.filter((t) => t.isActive)}
          accounts={accounts}
          onClose={() => setVoucher(null)}
        />
      ) : null}

      {transferOpen ? (
        <TransferModal treasuries={treasuries.filter((t) => t.isActive)} onClose={() => setTransferOpen(false)} />
      ) : null}

      {manageTreasury ? <TreasuryManageModal treasury={manageTreasury === "NEW" ? null : manageTreasury} onClose={() => setManageTreasury(null)} /> : null}
      {deleteTreasury ? <DeleteTreasuryModal treasury={deleteTreasury} onClose={() => setDeleteTreasury(null)} onDone={() => { setDeleteTreasury(null); router.refresh(); }} /> : null}

      {shiftAction ? (
        <ShiftModal
          mode={shiftAction.mode}
          treasury={shiftAction.treasury}
          onClose={() => setShiftAction(null)}
        />
      ) : null}
    </div>
  );
}

function DeleteTreasuryModal({ treasury, onClose, onDone }: { treasury: TreasuryRow; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = () => startTransition(async () => {
    const result = await deleteTreasuryAction(treasury.id);
    if (!result.success) { setError(result.error); return; }
    onDone();
  });
  return <Modal open onClose={onClose} title={`حذف الخزينة — ${treasury.name}`} description="سيُنفّذ الحذف النهائي فقط للخزينة الفارغة التي لا تمتلك أي سجل مالي أو تشغيلي." size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button variant="danger" onClick={submit} loading={pending}><Trash2 size={15} /> حذف نهائي</Button></>}><div className="space-y-3">{error ? <Alert variant="error">{error}</Alert> : null}<Alert variant="warning">لا يمكن الحذف إذا كان الرصيد لا يساوي صفراً أو وُجدت حركات أو فواتير أو ورديات أو تحويلات تاريخية. في هذه الحالة عطّل الخزينة بدلاً من حذفها.</Alert><div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-sm"><Row label="الرصيد الحالي" value={`${formatMoney(treasury.currentBalance)} ${CURRENCY}`} bold /><Row label="الحالة" value={treasury.isActive ? "نشطة" : "معطلة"} /></div></div></Modal>;
}

function DeleteManualTreasuryTransactionsModal({ transactions, onClose, onDone }: { transactions: TransactionRow[]; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const total = transactions.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const submit = () => startTransition(async () => { const result = await deleteManualTreasuryTransactionsAction({ transactionIds: transactions.map((transaction) => transaction.id) }); if (!result.success) { setError(result.error); return; } onDone(); });
  return <Modal open onClose={onClose} title="تأكيد الحذف النهائي واسترجاع القيم" description={`سيُعكس ${transactions.length} سند يدوي بقيمة ${formatMoney(total)} ${CURRENCY}.`} size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button variant="danger" onClick={submit} loading={pending}><Trash2 size={15} /> حذف وعكس السندات</Button></>}><div className="space-y-3">{error ? <Alert variant="error">{error}</Alert> : null}<Alert variant="warning">السندات المحددة ستُحذف بعد عكس أثرها على الخزينة والحساب. لا يمكن حذف سندات الفواتير أو التحويلات من هذه الشاشة.</Alert><div className="max-h-32 overflow-auto rounded-lg border border-bmw-cardBorder bg-bmw-carbon p-2 font-mono text-xs">{transactions.map((transaction) => <p key={transaction.id}>{transaction.transactionNumber}</p>)}</div></div></Modal>;
}

function Row({ label, value, tone, bold }: { label: string; value: string; tone?: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-bmw-muted">{label}</span>
      <span className={`tabular ${bold ? "font-bold" : ""} ${tone ?? "text-white"}`}>{value}</span>
    </div>
  );
}

function VoucherModal({
  type,
  treasuries,
  accounts,
  onClose,
}: {
  type: "RECEIPT" | "PAYMENT";
  treasuries: TreasuryRow[];
  accounts: TreasuryClientProps["accounts"];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [treasuryId, setTreasuryId] = useState(treasuries[0]?.id ?? "");
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const parsedAmount = Number(amount) || 0;
  const treasury = treasuries.find((t) => t.id === treasuryId);
  const insufficient = type === "PAYMENT" && !!treasury && parsedAmount > treasury.currentBalance;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createTreasuryTransactionAction({
        treasuryId,
        accountId,
        type,
        amount: parsedAmount,
        description,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess(`تم تسجيل السند رقم ${result.data.transactionNumber}`);
      setAmount("");
      setDescription("");
      router.refresh();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={type === "RECEIPT" ? "سند قبض" : "سند صرف"}
      description={
        type === "RECEIPT"
          ? "تحصيل نقدي من عميل أو ورشة — يقيد في الخزينة ويخفض مديونية الحساب."
          : "صرف نقدي لمورد أو مصروف — يخفض رصيد الخزينة."
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            إغلاق
          </Button>
          <Button
            variant={type === "RECEIPT" ? "success" : "danger"}
            onClick={submit}
            loading={pending}
            disabled={!treasuryId || parsedAmount <= 0 || description.trim().length < 3 || insufficient}
          >
            تسجيل السند
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {success ? <Alert variant="success">{success}</Alert> : null}

        <Field label="الخزينة" required>
          <Select value={treasuryId} onChange={(e) => setTreasuryId(e.target.value)}>
            <option value="">— اختر —</option>
            {treasuries.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {formatMoney(t.currentBalance)} {CURRENCY}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="الحساب (اختياري)" hint="اتركه فارغاً للحركات غير المرتبطة بحساب">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— بدون حساب —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.accountNumber})
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="المبلغ"
          required
          error={insufficient ? `السيولة المتاحة ${formatMoney(treasury!.currentBalance)} فقط` : undefined}
        >
          <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>

        <Field label="البيان" required hint="٣ أحرف على الأقل">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function TransferModal({ treasuries, onClose }: { treasuries: TreasuryRow[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fromId, setFromId] = useState(treasuries[0]?.id ?? "");
  const [toId, setToId] = useState(treasuries[1]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const parsedAmount = Number(amount) || 0;
  const from = treasuries.find((t) => t.id === fromId);
  const insufficient = !!from && parsedAmount > from.currentBalance;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await transferBetweenTreasuriesAction({
        fromTreasuryId: fromId,
        toTreasuryId: toId,
        amount: parsedAmount,
        description,
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
      title="تحويل داخلي بين الخزائن"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={!fromId || !toId || fromId === toId || parsedAmount <= 0 || insufficient || description.trim().length < 3}
          >
            تنفيذ التحويل
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Field label="من خزينة" required>
          <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {treasuries.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {formatMoney(t.currentBalance)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="إلى خزينة" required error={fromId === toId ? "لا يمكن التحويل لنفس الخزينة" : undefined}>
          <Select value={toId} onChange={(e) => setToId(e.target.value)}>
            {treasuries.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {formatMoney(t.currentBalance)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="المبلغ"
          required
          error={insufficient ? `الرصيد المتاح ${formatMoney(from!.currentBalance)} فقط` : undefined}
        >
          <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="البيان" required>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="إيداع بنكي" />
        </Field>
      </div>
    </Modal>
  );
}

function ShiftModal({
  mode,
  treasury,
  onClose,
}: {
  mode: "open" | "close";
  treasury: TreasuryRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(mode === "open" ? String(treasury.currentBalance) : "");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{
    variance: number;
    systemBalance: number;
    postedTransactionNumber: string | null;
  } | null>(null);

  const parsed = Number(value) || 0;
  const variance = mode === "close" ? parsed - treasury.currentBalance : 0;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      if (mode === "open") {
        const res = await openShiftAction({ treasuryId: treasury.id, openingBalance: parsed, notes });
        if (!res.success) {
          setError(res.error);
          return;
        }
        onClose();
        router.refresh();
        return;
      }
      if (!treasury.openShift) {
        setError("لا توجد وردية مفتوحة لهذه الخزينة.");
        return;
      }
      const res = await closeShiftAction({ shiftId: treasury.openShift.id, countedCash: parsed, notes });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setResult({
        variance: res.data.variance,
        systemBalance: res.data.systemBalance,
        postedTransactionNumber: res.data.postedTransactionNumber,
      });
      router.refresh();
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "open" ? `فتح وردية — ${treasury.name}` : `إغلاق الوردية — ${treasury.name}`}
      description={
        mode === "open"
          ? "يُسجَّل رصيد بداية الوردية للمقارنة عند الإغلاق."
          : "أدخل النقدية المعدودة فعلياً في الدرج لحساب الفرق."
      }
      size="sm"
      footer={
        result ? (
          <Button onClick={onClose}>تم</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              إلغاء
            </Button>
            <Button onClick={submit} loading={pending} disabled={parsed < 0}>
              {mode === "open" ? "فتح الوردية" : "إغلاق وإصدار تقرير Z"}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3 text-center">
          <p className="text-sm font-bold text-white">تم إغلاق الوردية</p>
          <div className="space-y-1.5 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-4 text-right text-sm">
            <Row label="الرصيد الدفتري" value={formatMoney(result.systemBalance)} />
            <Row
              label="الفرق"
              value={formatMoney(result.variance)}
              tone={Math.abs(result.variance) < 0.01 ? "text-emerald-400" : "text-bmw-mRed"}
              bold
            />
          </div>
          {result.postedTransactionNumber ? (
            <Alert variant="warning">
              تم ترحيل فرق الجرد إلى الخزينة بالسند رقم{" "}
              <span className="font-mono font-bold">{result.postedTransactionNumber}</span> وتعديل الرصيد
              الدفتري ليطابق النقدية المعدودة.
            </Alert>
          ) : (
            <Alert variant="success">لا يوجد فرق — النقدية المعدودة تطابق الرصيد الدفتري.</Alert>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {error ? <Alert variant="error">{error}</Alert> : null}
          <div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-sm">
            <Row label="الرصيد الدفتري الحالي" value={formatMoney(treasury.currentBalance)} bold />
          </div>
          <Field
            label={mode === "open" ? "رصيد بداية الوردية" : "النقدية المعدودة فعلياً"}
            required
            hint={
              mode === "close" && value !== ""
                ? `الفرق: ${formatMoney(variance)} ${CURRENCY}`
                : undefined
            }
          >
            <Input type="number" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </Field>
          <Field label="ملاحظات">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function TreasuryManageModal({ treasury, onClose }: { treasury: TreasuryRow | null; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(treasury?.name ?? "");
  const [type, setType] = useState(treasury?.type ?? "CASH_DRAWER");
  const [notes, setNotes] = useState(treasury?.notes ?? "");
  const [isDefault, setIsDefault] = useState(treasury?.isDefault ?? false);
  const [isActive, setIsActive] = useState(treasury?.isActive ?? true);
  const [openingBalance, setOpeningBalance] = useState("0");
  const parsedOpeningBalance = openingBalance.trim() === "" ? 0 : Number(openingBalance);
  const submit = () => {
    setError(null);
    startTransition(async () => {
      const payload = { name, type: type as "CASH_DRAWER" | "BANK_ACCOUNT" | "POS_TERMINAL" | "WALLET" | "INSTAPAY" | "OTHER", notes, isDefault, isActive };
      const result = treasury
        ? await updateTreasuryAction(treasury.id, payload)
        : await createTreasuryAction({ ...payload, openingBalance: parsedOpeningBalance });
      if (!result.success) { setError(result.error); return; }
      onClose();
      router.refresh();
    });
  };
  return <Modal open onClose={onClose} title={treasury ? `إدارة خزينة — ${treasury.name}` : "إنشاء خزينة جديدة"} description={treasury ? "عدّل بيانات التعريف فقط. استخدم أزرار البطاقة المخصصة للتنشيط أو التعطيل والحذف المحمي." : "يمكن إدخال رصيد افتتاحي غير سالب؛ يُرحّل تلقائياً كسند قبض افتتاحي مدقق."} size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إغلاق</Button><Button onClick={submit} loading={pending} disabled={name.trim().length < 2 || !Number.isFinite(parsedOpeningBalance) || parsedOpeningBalance < 0}><Settings2 size={15} /> حفظ</Button></>}>
    <div className="space-y-3">
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Field label="اسم الخزينة" required><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></Field>
      <Field label="النوع" required><Select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="CASH_DRAWER">درج نقدية</option><option value="BANK_ACCOUNT">حساب بنكي</option><option value="POS_TERMINAL">نقطة بيع</option><option value="WALLET">محفظة إلكترونية</option><option value="INSTAPAY">إنستاباي</option><option value="OTHER">أخرى</option></Select></Field>
      {!treasury ? <Field label="الرصيد الافتتاحي" hint="سيُرحّل كسند قبض افتتاحي قابل للتدقيق"><Input type="number" min={0} step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></Field> : null}
      <Field label="ملاحظات"><Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="مثال: خزينة فرع مدينة نصر أو محفظة التحصيل الإلكتروني" /></Field>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-bmw-silver"><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} className="accent-bmw-blue" />الخزينة الافتراضية</label>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-bmw-silver"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="accent-bmw-blue" />الخزينة نشطة</label>
      {treasury ? <Alert variant="warning">تعطيل الخزينة يمنع ظهورها فوراً في نقاط البيع والفواتير والمرتجعات، بينما يحتفظ بسجلها المالي كاملاً.</Alert> : null}
    </div>
  </Modal>;
}

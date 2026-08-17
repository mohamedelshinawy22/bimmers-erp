"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck, Plus, Search, ShoppingBag, Trash2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { CURRENCY, formatMoney, formatOemNumber } from "@/lib/utils";
import { lineTotal as calcLineTotal, round2, sum as sumMoney, taxOf } from "@/lib/money";
import type { PosPartRow } from "@/server/services/parts.service";
import { searchPartsForPosAction } from "@/server/actions/search.actions";
import { createPurchaseInvoiceAction } from "@/server/actions/invoice.actions";

interface Line {
  part: PosPartRow;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
}

interface PurchaseInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  suppliers: Array<{ id: string; name: string; accountNumber: string; currentBalance: number }>;
  treasuries: Array<{ id: string; name: string; currentBalance: number }>;
  taxRatePercent: number;
}

/**
 * Goods receipt.
 *
 * This is what makes purchase invoices reachable. Without it stock could only be
 * added through manual adjustment, which had no cost input — so received parts
 * were valued at zero and every subsequent sale reported ~100% margin.
 */
export function PurchaseInvoiceModal({
  open,
  onClose,
  suppliers,
  treasuries,
  taxRatePercent,
}: PurchaseInvoiceModalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [supplierId, setSupplierId] = useState("");
  const [treasuryId, setTreasuryId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "VISA" | "ON_ACCOUNT">("ON_ACCOUNT");
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [paidInput, setPaidInput] = useState("0");
  const [notes, setNotes] = useState("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosPartRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ invoiceNumber: string; grandTotal: number } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      const res = await searchPartsForPosAction(term);
      if (id !== requestId.current) return;
      setSearching(false);
      if (res.success) setResults(res.data);
      else setError(res.error);
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  const addLine = (part: PosPartRow) => {
    setError(null);
    setLines((current) => {
      const i = current.findIndex((l) => l.part.id === part.id);
      if (i >= 0) {
        const next = [...current];
        next[i] = { ...next[i]!, quantity: next[i]!.quantity + 1 };
        return next;
      }
      return [...current, { part, quantity: 1, unitPrice: 0, lineDiscount: 0 }];
    });
    setQuery("");
    setResults([]);
    searchRef.current?.focus();
  };

  const updateLine = (partId: string, patch: Partial<Omit<Line, "part">>) => {
    setLines((current) =>
      current.map((l) => {
        if (l.part.id !== partId) return l;
        const next = { ...l, ...patch };
        if (next.quantity < 1) next.quantity = 1;
        if (next.unitPrice < 0) next.unitPrice = 0;
        if (next.lineDiscount < 0) next.lineDiscount = 0;
        const gross = round2(next.quantity * next.unitPrice);
        if (next.lineDiscount > gross) next.lineDiscount = gross;
        return next;
      }),
    );
  };

  const subtotal = useMemo(
    () => sumMoney(lines.map((l) => calcLineTotal(l.quantity, l.unitPrice, l.lineDiscount))),
    [lines],
  );
  const discount = Math.min(round2(invoiceDiscount), subtotal);
  const taxable = round2(subtotal - discount);
  const taxAmount = taxOf(taxable, taxRatePercent);
  const grandTotal = round2(taxable + taxAmount);

  const payFull = paymentMethod !== "ON_ACCOUNT" && paidInput.trim() === "";
  const paid = paymentMethod === "ON_ACCOUNT" ? 0 : payFull ? grandTotal : round2(Number(paidInput) || 0);
  const appliedPaid = Math.min(paid, grandTotal);
  const treasury = treasuries.find((t) => t.id === treasuryId);
  const insufficient = appliedPaid > 0 && !!treasury && appliedPaid > treasury.currentBalance;

  const missingCost = lines.filter((l) => l.unitPrice <= 0);
  const canSubmit =
    lines.length > 0 &&
    !!supplierId &&
    missingCost.length === 0 &&
    !insufficient &&
    !(appliedPaid > 0 && !treasuryId);

  const reset = () => {
    setLines([]);
    setInvoiceDiscount(0);
    setPaidInput("0");
    setNotes("");
    setPaymentMethod("ON_ACCOUNT");
    setError(null);
  };

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await createPurchaseInvoiceAction({
        accountId: supplierId,
        treasuryId: appliedPaid > 0 || payFull ? treasuryId : "",
        vehicleId: "",
        paymentMethod,
        discountAmount: discount,
        taxAmount,
        paidAmount: payFull ? 0 : appliedPaid,
        payFull,
        notes,
        items: lines.map((l) => ({
          partId: l.part.id,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineDiscount: l.lineDiscount,
        })),
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setDone({ invoiceNumber: res.data.invoiceNumber, grandTotal: res.data.grandTotal });
      reset();
      router.refresh();
    });
  };

  if (done) {
    return (
      <Modal
        open
        onClose={() => {
          setDone(null);
          onClose();
        }}
        title="تم استلام الشحنة"
        size="sm"
        footer={
          <Button
            onClick={() => {
              setDone(null);
              onClose();
            }}
          >
            تم
          </Button>
        }
      >
        <div className="space-y-3 text-center">
          <PackageCheck size={36} className="mx-auto text-emerald-400" />
          <p className="tabular text-xl font-bold text-white">{done.invoiceNumber}</p>
          <p className="text-sm text-bmw-muted">
            إجمالي الفاتورة {formatMoney(done.grandTotal)} {CURRENCY}
          </p>
          <Alert variant="success">
            تم تحديث الأرصدة ومتوسط تكلفة الأصناف (بعد خصم الخصومات) وتسجيل الحركات في دفتر المخزون.
          </Alert>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="فاتورة شراء — استلام شحنة واردة"
      description="سعر الشراء المُدخَل هنا يحدّد متوسط تكلفة الصنف، وبالتالي هامش الربح في كل بيعة قادمة."
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button onClick={submit} loading={pending} disabled={!canSubmit}>
            <ShoppingBag size={16} /> حفظ فاتورة الشراء
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert variant="error">{error}</Alert> : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="المورد" required>
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— اختر المورد —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.accountNumber})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="طريقة السداد" required>
            <Select
              value={paymentMethod}
              onChange={(e) => {
                setPaymentMethod(e.target.value as typeof paymentMethod);
                setPaidInput(e.target.value === "ON_ACCOUNT" ? "0" : "");
              }}
            >
              <option value="ON_ACCOUNT">على الحساب (آجل)</option>
              <option value="CASH">نقدي</option>
              <option value="VISA">تحويل / فيزا</option>
            </Select>
          </Field>
          {paymentMethod !== "ON_ACCOUNT" ? (
            <Field
              label="الخزينة"
              required
              error={insufficient ? `السيولة المتاحة ${formatMoney(treasury!.currentBalance)}` : undefined}
            >
              <Select value={treasuryId} onChange={(e) => setTreasuryId(e.target.value)}>
                <option value="">— اختر —</option>
                {treasuries.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {formatMoney(t.currentBalance)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>

        <div className="relative">
          <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث عن الصنف بالـ OEM أو الاسم لإضافته للشحنة…"
            className="pr-9"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
              }}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-bmw-muted hover:text-white"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>

        {searching ? <p className="text-xs text-bmw-muted">جاري البحث…</p> : null}

        {results.length > 0 ? (
          <ul className="max-h-48 divide-y divide-bmw-cardBorder overflow-y-auto rounded-xl border border-bmw-cardBorder bg-bmw-carbon">
            {results.map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  onClick={() => addLine(part)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2 text-right transition-colors hover:bg-bmw-card"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-white">{part.nameAr}</p>
                    <p className="font-mono text-[11px] text-bmw-muted">
                      {formatOemNumber(part.oemNumber)} • {part.brandName}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="muted" mono>
                      رصيد {part.stockQuantity}
                    </Badge>
                    <Plus size={14} className="text-bmw-blue" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {lines.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <ShoppingBag size={32} className="mx-auto mb-2 text-bmw-cardBorder" />
              <p className="text-sm font-bold text-bmw-silver">لم يتم إضافة أصناف للشحنة</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                أصناف الشحنة
                <Badge variant="muted" mono>
                  {lines.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <div className="divide-y divide-bmw-cardBorder">
              {lines.map((line) => (
                <div key={line.part.id} className="p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{line.part.nameAr}</p>
                      <p className="font-mono text-[11px] text-bmw-muted">
                        {formatOemNumber(line.part.oemNumber)} • الرصيد الحالي {line.part.stockQuantity}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLines((c) => c.filter((l) => l.part.id !== line.part.id))}
                      className="rounded-lg p-1.5 text-bmw-muted hover:bg-bmw-mRed/10 hover:text-bmw-mRed"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Field label="الكمية المستلمة">
                      <Input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => updateLine(line.part.id, { quantity: Number(e.target.value) })}
                      />
                    </Field>
                    <Field
                      label="سعر الشراء للوحدة"
                      error={line.unitPrice <= 0 ? "مطلوب" : undefined}
                    >
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(line.part.id, { unitPrice: Number(e.target.value) })}
                        className={line.unitPrice <= 0 ? "border-bmw-mRed" : undefined}
                      />
                    </Field>
                    <Field label="خصم السطر">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.lineDiscount}
                        onChange={(e) => updateLine(line.part.id, { lineDiscount: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="إجمالي السطر">
                      <div className="tabular flex h-10 items-center justify-end rounded-xl border border-bmw-cardBorder bg-bmw-black px-3 text-sm font-bold text-white">
                        {formatMoney(calcLineTotal(line.quantity, line.unitPrice, line.lineDiscount))}
                      </div>
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {missingCost.length > 0 ? (
          <Alert variant="warning">
            {missingCost.length} صنف بدون سعر شراء. التكلفة مطلوبة لحساب متوسط التكلفة وهامش الربح.
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Field label="خصم على إجمالي الفاتورة" hint="يُوزَّع على الأصناف لتخفيض التكلفة الفعلية">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={invoiceDiscount}
                onChange={(e) => setInvoiceDiscount(Number(e.target.value) || 0)}
              />
            </Field>
            {paymentMethod !== "ON_ACCOUNT" ? (
              <Field label="المبلغ المسدد" hint="اتركه فارغاً للسداد الكامل">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={paidInput}
                  onChange={(e) => setPaidInput(e.target.value)}
                  placeholder={String(grandTotal)}
                />
              </Field>
            ) : null}
            <Field label="ملاحظات">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>

          <div className="space-y-1.5 self-start rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-bmw-muted">إجمالي الأصناف</span>
              <span className="tabular font-bold">{formatMoney(subtotal)}</span>
            </div>
            {discount > 0 ? (
              <div className="flex justify-between">
                <span className="text-bmw-muted">الخصم</span>
                <span className="tabular text-amber-400">−{formatMoney(discount)}</span>
              </div>
            ) : null}
            {taxAmount > 0 ? (
              <div className="flex justify-between">
                <span className="text-bmw-muted">الضريبة ({taxRatePercent}%)</span>
                <span className="tabular">{formatMoney(taxAmount)}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between border-t border-bmw-cardBorder pt-2">
              <span className="font-bold text-white">الإجمالي</span>
              <span className="tabular text-xl font-bold text-bmw-blue">
                {formatMoney(grandTotal)} <span className="text-xs text-bmw-muted">{CURRENCY}</span>
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-bmw-muted">المسدد الآن</span>
              <span className="tabular text-emerald-400">{formatMoney(appliedPaid)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-bmw-muted">يُضاف لحساب المورد</span>
              <span className="tabular text-purple-400">{formatMoney(round2(grandTotal - appliedPaid))}</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

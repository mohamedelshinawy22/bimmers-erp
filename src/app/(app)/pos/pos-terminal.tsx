"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  CreditCard,
  MapPin,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
  UserRound,
  X,
  Plus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StockBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { CURRENCY, formatMoney, formatOemNumber } from "@/lib/utils";
import { lineTotal as calcLineTotal, round2, sum as sumMoney, taxOf } from "@/lib/money";
import type { PosPartRow } from "@/server/services/parts.service";
import type { AccountVehicle, PosAccount } from "@/server/services/accounts.service";
import { getAccountVehiclesAction, searchPartsForPosAction } from "@/server/actions/search.actions";
import { createSaleInvoiceAction, type InvoiceResult } from "@/server/actions/invoice.actions";
import { holdSaleAction } from "@/server/actions/held-sales.actions";
import { createQuickPosAccountAction } from "@/server/actions/accounts.actions";
import { QuickPartModal } from "@/components/pos/quick-part-modal";
import { useInvoicePrint } from "@/hooks/use-invoice-print";
import { PrintContainer } from "@/components/print/print-container";
import { PRINT_FORMATS, type InvoicePrintFormat } from "@/lib/invoice-print-types";

/**
 * Available = on hand − reserved, matching the server's check in
 * `invoice.service.ts`. The client previously ignored `stockReserved`, so once
 * anything reserved stock the cart would accept quantities checkout rejects.
 */
function QuickAccountModal({ onClose, onCreated }: { onClose: () => void; onCreated: (account: PosAccount) => void }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [type, setType] = useState<"CUSTOMER" | "WORKSHOP_BMW">("CUSTOMER"); const [error, setError] = useState(""); const [pending, startTransition] = useTransition();
  const submit = () => startTransition(async () => { const result = await createQuickPosAccountAction({ name, phone, type, notes: "إنشاء سريع من نقطة البيع", email: "", address: "", taxNumber: "", category: "", creditLimit: 0, defaultPriceTier: "RETAIL", openingBalance: 0, status: "ACTIVE" }); if (!result.success) { setError(result.error); return; } onCreated({ ...result.data, vehicleCount: 0 }); });
  return <Modal open onClose={onClose} title="حساب عميل سريع" description="يتم اختيار الحساب الجديد فوراً مع الاحتفاظ بسلة البيع." size="sm" footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button loading={pending} disabled={!name.trim() || !phone.trim()} onClick={submit}>إنشاء واختيار</Button></>}><div className="space-y-3">{error ? <Alert variant="error">{error}</Alert> : null}<Field label="الاسم" required><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></Field><Field label="الهاتف" required><Input value={phone} onChange={(event) => setPhone(event.target.value)} /></Field><Field label="النوع"><Select value={type} onChange={(event) => setType(event.target.value as "CUSTOMER" | "WORKSHOP_BMW")}><option value="CUSTOMER">عميل</option><option value="WORKSHOP_BMW">مركز صيانة BMW</option></Select></Field></div></Modal>;
}

function availableOf(part: PosPartRow): number {
  return part.stockQuantity - part.stockReserved;
}

interface CartLine {
  part: PosPartRow;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
}

interface PosTerminalProps {
  accounts: PosAccount[];
  treasuries: Array<{ id: string; name: string; type: string }>;
  defaultAccountId: string | null;
  defaultTreasuryId: string | null;
  canOverrideMinPrice: boolean;
  taxRatePercent: number;
  companyName: string;
  /**
   * Server-resolved business rules, passed in so the client evaluates the same
   * conditions the server enforces instead of hardcoding its own variants.
   */
  enforceCreditLimit: boolean;
  allowNegativeStock: boolean;
  receiptFooter: string;
}

type PaymentMethod = "CASH" | "VISA" | "SPLIT" | "ON_ACCOUNT";

/**
 * Money helpers come from `@/lib/money`, which uses the same decimal engine and
 * rounding mode as the server. Plain `Math.round(n*100)/100` disagreed with the
 * server on half-piastre values (3 × 1.005 → 3.01 vs 3.02), which used to leave
 * a phantom 0.01 receivable and flip the invoice from PAID to PARTIAL.
 *
 * The server is authoritative regardless: it recomputes every figure from the
 * line items, and `payFull` tells it to settle in full using its own total.
 */

export function PosTerminal({
  accounts,
  treasuries,
  defaultAccountId,
  defaultTreasuryId,
  canOverrideMinPrice,
  taxRatePercent,
  companyName,
  enforceCreditLimit,
  allowNegativeStock,
  receiptFooter,
}: PosTerminalProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosPartRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);

  const [terminalAccounts, setTerminalAccounts] = useState(accounts);
  const [accountId, setAccountId] = useState(defaultAccountId ?? "");
  const [quickAccountOpen, setQuickAccountOpen] = useState(false);
  const [quickPartOpen, setQuickPartOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [treasuryId, setTreasuryId] = useState(defaultTreasuryId ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [invoiceDiscount, setInvoiceDiscount] = useState(0);
  const [paidInput, setPaidInput] = useState("");
  const [notes, setNotes] = useState("");
  const [overrideMinPrice, setOverrideMinPrice] = useState(false);

  const [vehicles, setVehicles] = useState<AccountVehicle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<InvoiceResult | null>(null);
  const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const account = useMemo(() => terminalAccounts.find((a) => a.id === accountId), [terminalAccounts, accountId]);
  const isWholesale = account?.defaultPriceTier === "WHOLESALE";

  // Vehicles are fetched per selected account rather than embedded in the page
  // payload for every account up front.
  useEffect(() => {
    if (!accountId || !account || account.vehicleCount === 0) {
      setVehicles([]);
      return;
    }
    let cancelled = false;
    void getAccountVehiclesAction(accountId).then((res) => {
      if (cancelled) return;
      if (res.success) setVehicles(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, account]);

  /* ── Search (debounced, out-of-order safe) ──────────────────────────────── */
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
      const result = await searchPartsForPosAction(term);
      // Discard stale responses so fast typing can't rewind the list.
      if (id !== requestId.current) return;
      setSearching(false);
      if (result.success) setResults(result.data);
      else setError(result.error);
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  /* ── Cart operations ────────────────────────────────────────────────────── */
  const addToCart = useCallback(
    (part: PosPartRow) => {
      setError(null);
      setCart((current) => {
        const available = availableOf(part);
        const index = current.findIndex((l) => l.part.id === part.id);
        if (index >= 0) {
          const existing = current[index]!;
          if (!allowNegativeStock && existing.quantity + 1 > available) {
            setError(`الرصيد المتاح للصنف "${part.nameAr}" هو ${available} فقط.`);
            return current;
          }
          const next = [...current];
          next[index] = { ...existing, quantity: existing.quantity + 1 };
          return next;
        }
        if (!allowNegativeStock && available <= 0) {
          setError(`الصنف "${part.nameAr}" نافد من المخزون.`);
          return current;
        }
        return [
          ...current,
          {
            part,
            quantity: 1,
            unitPrice: isWholesale ? part.sellPriceWholesale : part.sellPriceRetail,
            lineDiscount: 0,
          },
        ];
      });
      setQuery("");
      setResults([]);
      searchRef.current?.focus();
    },
    [isWholesale, allowNegativeStock],
  );

  const updateLine = (partId: string, patch: Partial<Omit<CartLine, "part">>) => {
    setCart((current) =>
      current.map((line) => {
        if (line.part.id !== partId) return line;
        const next = { ...line, ...patch };
        const available = availableOf(line.part);
        if (!allowNegativeStock && next.quantity > available) {
          setError(`الرصيد المتاح للصنف "${line.part.nameAr}" هو ${available} فقط.`);
          next.quantity = Math.max(1, available);
        }
        if (next.quantity < 1) next.quantity = 1;
        if (next.unitPrice < 0) next.unitPrice = 0;
        if (next.lineDiscount < 0) next.lineDiscount = 0;
        const gross = round2(next.quantity * next.unitPrice);
        if (next.lineDiscount > gross) next.lineDiscount = round2(gross);
        return next;
      }),
    );
  };

  const removeLine = (partId: string) => setCart((c) => c.filter((l) => l.part.id !== partId));

  const resetInvoice = () => {
    setCart([]);
    setInvoiceDiscount(0);
    setPaidInput("");
    setNotes("");
    setVehicleId("");
    setOverrideMinPrice(false);
    setPaymentMethod("CASH");
    setError(null);
  };

  /* ── Totals (mirror the server's Decimal math) ──────────────────────────── */
  const subtotal = useMemo(
    () => sumMoney(cart.map((l) => calcLineTotal(l.quantity, l.unitPrice, l.lineDiscount))),
    [cart],
  );
  const discount = Math.min(round2(invoiceDiscount), subtotal);
  const taxable = round2(subtotal - discount);
  const taxAmount = taxOf(taxable, taxRatePercent);
  const grandTotal = round2(taxable + taxAmount);

  // Empty input means "settle in full" — sent as payFull so the server uses its
  // own total rather than a client figure that could differ by a piastre.
  const payFull = paymentMethod !== "ON_ACCOUNT" && paidInput.trim() === "";
  const paidAmount =
    paymentMethod === "ON_ACCOUNT" ? 0 : payFull ? grandTotal : round2(Number(paidInput) || 0);
  const appliedPaid = Math.min(paidAmount, grandTotal);
  const changeDue = round2(Math.max(0, paidAmount - grandTotal));
  const remaining = round2(grandTotal - appliedPaid);

  const belowMinLines = cart.filter((l) => l.unitPrice < l.part.sellPriceMin);

  /**
   * Mirrors the server's credit gate exactly: it only applies when the balance
   * would actually go negative (a prepaid customer can still buy on account) and
   * only when ENFORCE_CREDIT_LIMIT is on. The previous client rule ignored both
   * conditions and blocked sales the server would have accepted.
   */
  const balanceAfterSale = account ? round2(account.currentBalance - remaining) : 0;
  const wouldOweUs = !!account && remaining > 0 && balanceAfterSale < 0;
  const creditDebtAfter = wouldOweUs ? Math.abs(balanceAfterSale) : 0;
  const creditBlocked = enforceCreditLimit && wouldOweUs && account!.creditLimit === 0;
  const creditExceeded =
    enforceCreditLimit && wouldOweUs && account!.creditLimit > 0 && creditDebtAfter > account!.creditLimit;

  const canCheckout =
    cart.length > 0 &&
    !!accountId &&
    grandTotal >= 0 &&
    !(belowMinLines.length > 0 && !overrideMinPrice) &&
    !creditExceeded &&
    !creditBlocked &&
    !(appliedPaid > 0 && !treasuryId);

  const holdCurrentCart = useCallback(() => {
    if (!cart.length || pending) return;
    startTransition(async () => {
      const result = await holdSaleAction({
        accountId: accountId || undefined,
        treasuryId: treasuryId || undefined,
        paymentMethod,
        discountAmount: discount,
        taxAmount,
        paidAmount: appliedPaid,
        notes,
        items: cart.map((line) => ({ partId: line.part.id, quantity: line.quantity, unitPrice: line.unitPrice, lineDiscount: line.lineDiscount })),
      });
      if (!result.success) { setError(result.error); return; }
      resetInvoice();
      setError(`تم تعليق الفاتورة برقم ${result.data.holdNumber}.`);
    });
  }, [accountId, appliedPaid, cart, discount, notes, paymentMethod, pending, resetInvoice, startTransition, taxAmount, treasuryId]);

  /* ── Hotkeys local to the POS ───────────────────────────────────────────── */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.altKey && event.key.toLowerCase() === "n") { event.preventDefault(); setQuickAccountOpen(true); }
      if (event.altKey && event.key.toLowerCase() === "p") { event.preventDefault(); setQuickPartOpen(true); }
      if (event.key === "F9" && !checkoutOpen) {
        event.preventDefault();
        if (canCheckout) setCheckoutOpen(true);
      }
      if (event.key === "F8") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "F12" && !checkoutOpen) {
        event.preventDefault();
        holdCurrentCart();
      }
      if (event.key === "Escape" && !checkoutOpen) {
        setQuery("");
        setResults([]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canCheckout, checkoutOpen, holdCurrentCart]);

  /* ── Submit ─────────────────────────────────────────────────────────────── */
  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createSaleInvoiceAction({
        accountId,
        treasuryId: payFull || appliedPaid > 0 ? treasuryId : "",
        vehicleId: vehicleId || "",
        paymentMethod,
        discountAmount: discount,
        // Advisory only — the server recomputes tax from TAX_RATE_PERCENT.
        taxAmount,
        paidAmount: payFull ? 0 : appliedPaid,
        payFull,
        notes,
        allowBelowMinPrice: overrideMinPrice,
        allowDiscountOverride: overrideMinPrice,
        items: cart.map((l) => ({
          partId: l.part.id,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineDiscount: l.lineDiscount,
        })),
      });

      if (!result.success) {
        setError(result.error);
        return;
      }
      setCheckoutOpen(false);
      // Show the SERVER's figures on the receipt, never the local preview.
      setReceipt(result.data);
      resetInvoice();
      router.refresh();
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      {/* ══ Cart / lines ══ */}
      <div className="space-y-4 xl:col-span-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="relative">
              <Search size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted" />
              <Input
                ref={searchRef}
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث بالباركود أو رقم OEM أو اسم الصنف… (F8)"
                className="h-12 pr-10 text-base"
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
                  <X size={16} />
                </button>
              ) : null}
            </div>

            {searching ? <p className="text-xs text-bmw-muted">جاري البحث…</p> : null}

            {results.length > 0 ? (
              <ul className="max-h-72 divide-y divide-bmw-cardBorder overflow-y-auto rounded-xl border border-bmw-cardBorder bg-bmw-carbon">
                {results.map((part) => (
                  <li key={part.id}>
                    <button
                      type="button"
                      onClick={() => addToCart(part)}
                      disabled={!allowNegativeStock && availableOf(part) <= 0}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-right transition-colors hover:bg-bmw-card disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-white">{part.nameAr}</p>
                        <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-bmw-muted">
                          <span>{formatOemNumber(part.oemNumber)}</span>
                          <span className="text-bmw-cardBorder">|</span>
                          <span>{part.brandName}</span>
                          {part.binCode ? (
                            <>
                              <span className="text-bmw-cardBorder">|</span>
                              <span className="flex items-center gap-1 text-bmw-blue">
                                <MapPin size={10} />
                                {part.binCode}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StockBadge quantity={availableOf(part)} reorderLevel={part.minReorderLevel} />
                        <span className="tabular text-sm font-bold text-bmw-blue">
                          {formatMoney(isWholesale ? part.sellPriceWholesale : part.sellPriceRetail)}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {query.trim().length >= 2 && !searching && results.length === 0 ? <Button type="button" variant="outline" className="w-full" onClick={() => setQuickPartOpen(true)}><Plus size={15}/> إضافة صنف جديد "{query.trim()}"</Button> : null}
            <Button type="button" size="sm" variant="ghost" onClick={() => setQuickPartOpen(true)}><Plus size={14}/> صنف جديد (Alt+P)</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <ShoppingCart size={18} className="text-bmw-blue" /> أصناف الفاتورة
              <Badge variant="muted" mono>
                {cart.length}
              </Badge>
            </CardTitle>
            {cart.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={resetInvoice}>
                <Trash2 size={14} /> إفراغ
              </Button>
            ) : null}
          </CardHeader>

          {cart.length === 0 ? (
            <CardContent className="py-16 text-center">
              <ShoppingCart size={36} className="mx-auto mb-3 text-bmw-cardBorder" />
              <p className="text-sm font-bold text-bmw-silver">لم يتم إضافة أصناف بعد</p>
              <p className="mt-1 text-xs text-bmw-muted">
                ابحث بالباركود أو رقم القطعة الأصلي لبدء الفاتورة.
              </p>
            </CardContent>
          ) : (
            <div className="divide-y divide-bmw-cardBorder">
              {cart.map((line) => {
                const belowMin = line.unitPrice < line.part.sellPriceMin;
                const lineTotal = calcLineTotal(line.quantity, line.unitPrice, line.lineDiscount);
                return (
                  <div key={line.part.id} className="p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-white">{line.part.nameAr}</p>
                        <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-bmw-muted">
                          <span>{formatOemNumber(line.part.oemNumber)}</span>
                          <span className="text-bmw-cardBorder">|</span>
                          <span>{line.part.brandName}</span>
                          {line.part.binCode ? (
                            <span className="flex items-center gap-1 text-bmw-blue">
                              <MapPin size={10} />
                              {line.part.binCode}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.part.id)}
                        className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-bmw-mRed/10 hover:text-bmw-mRed"
                        aria-label="حذف السطر"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field label="الكمية">
                        <Input
                          type="number"
                          min={1}
                          max={allowNegativeStock ? undefined : availableOf(line.part)}
                          value={line.quantity}
                          onChange={(e) => updateLine(line.part.id, { quantity: Number(e.target.value) })}
                        />
                      </Field>
                      <Field label="سعر الوحدة" error={belowMin ? `الحد الأدنى ${formatMoney(line.part.sellPriceMin)}` : undefined}>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) => updateLine(line.part.id, { unitPrice: Number(e.target.value) })}
                          className={belowMin ? "border-bmw-mRed text-bmw-mRed" : undefined}
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
                          {formatMoney(lineTotal)}
                        </div>
                      </Field>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {quickAccountOpen ? <QuickAccountModal onClose={() => setQuickAccountOpen(false)} onCreated={(created) => { setTerminalAccounts((current) => [...current, { ...created, vehicleCount: 0 }]); setAccountId(created.id); setVehicleId(""); setQuickAccountOpen(false); }} /> : null}
      {quickPartOpen ? <QuickPartModal initialName={query} onClose={() => setQuickPartOpen(false)} onCreated={(part) => { addToCart(part); setQuickPartOpen(false); }} /> : null}

      {/* ══ Totals / customer ══ */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <UserRound size={18} className="text-bmw-blue" /> بيانات العميل
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field label="الحساب" required>
              <Select
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  setVehicleId("");
                }}
              >
                <option value="">— اختر الحساب —</option>
                {terminalAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.accountNumber})
                  </option>
                ))}
              </Select>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setQuickAccountOpen(true)}><Plus size={14}/> حساب سريع</Button>
            </Field>

            {account ? (
              <div className="space-y-1 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-bmw-muted">الرصيد الحالي</span>
                  <span className={`tabular font-bold ${account.currentBalance < 0 ? "text-bmw-mRed" : "text-emerald-400"}`}>
                    {formatMoney(Math.abs(account.currentBalance))} {account.currentBalance < 0 ? "عليه" : "له"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-bmw-muted">حد الائتمان</span>
                  <span className="tabular">{formatMoney(account.creditLimit)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-bmw-muted">شريحة السعر</span>
                  <Badge variant={isWholesale ? "purple" : "blue"}>{isWholesale ? "جملة" : "قطاعي"}</Badge>
                </div>
              </div>
            ) : null}

            {account && vehicles.length > 0 ? (
              <Field label="سيارة العميل (اختياري)" hint="يُسجَّل رقم الشاسيه على الفاتورة">
                <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                  <option value="">— بدون سيارة —</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {[v.chassisCode, v.series, v.modelYear, v.plateNumber ?? v.vin.slice(-6)]
                        .filter(Boolean)
                        .join(" • ")}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>الإجماليات</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-bmw-muted">الإجمالي قبل الخصم</span>
                <span className="tabular font-bold">{formatMoney(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-bmw-muted">خصم الفاتورة</span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={invoiceDiscount}
                  onChange={(e) => setInvoiceDiscount(Number(e.target.value) || 0)}
                  className="h-8 w-28"
                />
              </div>
              {taxRatePercent > 0 ? (
                <div className="flex justify-between">
                  <span className="text-bmw-muted">ضريبة ({taxRatePercent}%)</span>
                  <span className="tabular">{formatMoney(taxAmount)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between border-t border-bmw-cardBorder pt-3">
                <span className="font-bold text-white">الإجمالي النهائي</span>
                <span className="tabular text-2xl font-bold text-bmw-blue">
                  {formatMoney(grandTotal)} <span className="text-xs text-bmw-muted">{CURRENCY}</span>
                </span>
              </div>
            </div>

            {belowMinLines.length > 0 ? (
              <Alert variant="warning">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    {belowMinLines.length} صنف بسعر أقل من الحد الأدنى.
                    {canOverrideMinPrice ? (
                      <label className="mt-2 flex cursor-pointer items-center gap-2 font-bold">
                        <input
                          type="checkbox"
                          checked={overrideMinPrice}
                          onChange={(e) => setOverrideMinPrice(e.target.checked)}
                          className="accent-bmw-blue"
                        />
                        اعتماد المدير للبيع تحت الحد الأدنى
                      </label>
                    ) : (
                      <span className="block font-bold">يلزم صلاحية مدير لاعتماد هذا السعر.</span>
                    )}
                  </div>
                </div>
              </Alert>
            ) : null}

            {creditBlocked ? (
              <Alert variant="error">هذا الحساب غير مسموح له بالبيع الآجل (حد الائتمان = صفر).</Alert>
            ) : creditExceeded ? (
              <Alert variant="error">
                تجاوز حد الائتمان: المديونية بعد الفاتورة {formatMoney(creditDebtAfter)} والحد{" "}
                {formatMoney(account!.creditLimit)}.
              </Alert>
            ) : null}

            {error ? <Alert variant="error">{error}</Alert> : null}

            <Button
              size="lg"
              className="w-full"
              disabled={!canCheckout}
              onClick={() => setCheckoutOpen(true)}
            >
              <Banknote size={18} /> إتمام الدفع (F9)
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ══ Checkout modal ══ */}
      <Modal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title="إتمام الدفع"
        description={`إجمالي مستحق: ${formatMoney(grandTotal)} ${CURRENCY}`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCheckoutOpen(false)} disabled={pending}>
              رجوع
            </Button>
            <Button onClick={submit} loading={pending} disabled={appliedPaid > 0 && !treasuryId}>
              تأكيد وحفظ الفاتورة
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "CASH", label: "نقدي", icon: Banknote },
                { value: "VISA", label: "فيزا / شبكة", icon: CreditCard },
                { value: "SPLIT", label: "دفع مقسّم", icon: Banknote },
                { value: "ON_ACCOUNT", label: "على الحساب", icon: UserRound },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              const active = paymentMethod === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setPaymentMethod(option.value);
                    if (option.value === "ON_ACCOUNT") setPaidInput("0");
                    else setPaidInput("");
                  }}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold transition-all ${
                    active
                      ? "border-bmw-blue bg-bmw-blue/10 text-white"
                      : "border-bmw-cardBorder bg-bmw-carbon text-bmw-muted hover:text-white"
                  }`}
                >
                  <Icon size={16} />
                  {option.label}
                </button>
              );
            })}
          </div>

          {paymentMethod !== "ON_ACCOUNT" ? (
            <>
              <Field label="الخزينة" required>
                <Select value={treasuryId} onChange={(e) => setTreasuryId(e.target.value)}>
                  <option value="">— اختر الخزينة —</option>
                  {treasuries.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="المبلغ المحصّل" hint="اتركه فارغاً للدفع الكامل">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={paidInput}
                  onChange={(e) => setPaidInput(e.target.value)}
                  placeholder={String(grandTotal)}
                  autoFocus
                />
              </Field>
            </>
          ) : (
            <Alert variant="info">سيتم ترحيل كامل قيمة الفاتورة على حساب العميل كمديونية آجلة.</Alert>
          )}

          <div className="space-y-1.5 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-bmw-muted">المدفوع</span>
              <span className="tabular font-bold text-emerald-400">{formatMoney(appliedPaid)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-bmw-muted">المتبقي (آجل)</span>
              <span className={`tabular font-bold ${remaining > 0 ? "text-amber-400" : "text-bmw-muted"}`}>
                {formatMoney(remaining)}
              </span>
            </div>
            {changeDue > 0 ? (
              <div className="flex justify-between border-t border-bmw-cardBorder pt-1.5">
                <span className="text-bmw-muted">الباقي للعميل</span>
                <span className="tabular font-bold text-bmw-blue">{formatMoney(changeDue)}</span>
              </div>
            ) : null}
          </div>

          <Field label="ملاحظات">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>

          {error ? <Alert variant="error">{error}</Alert> : null}
        </div>
      </Modal>

      {/* ══ Receipt modal ══ */}
      <Modal
        open={!!receipt}
        onClose={() => setReceipt(null)}
        title="تم حفظ الفاتورة بنجاح"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReceipt(null)}>
              إغلاق
            </Button>
            <Button variant="outline" onClick={() => receipt && setPrintInvoiceId(receipt.invoiceId)}>
              <Printer size={15} /> اختيار الطباعة
            </Button>
          </>
        }
      >
        {receipt ? (
          <div className="space-y-3 text-center">
            <p className="text-xs text-bmw-muted">{companyName}</p>
            {receiptFooter ? (
              <p className="text-[10px] text-bmw-muted">{receiptFooter}</p>
            ) : null}
            <p className="tabular text-2xl font-bold text-white">{receipt.invoiceNumber}</p>
            <div className="space-y-1.5 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-4 text-right text-sm">
              <div className="flex justify-between">
                <span className="text-bmw-muted">الإجمالي</span>
                <span className="tabular font-bold">{formatMoney(receipt.grandTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-bmw-muted">المدفوع</span>
                <span className="tabular font-bold text-emerald-400">{formatMoney(receipt.paidAmount)}</span>
              </div>
              {receipt.remainingAmount > 0 ? (
                <div className="flex justify-between">
                  <span className="text-bmw-muted">المتبقي آجل</span>
                  <span className="tabular font-bold text-amber-400">{formatMoney(receipt.remainingAmount)}</span>
                </div>
              ) : null}
              {receipt.changeDue > 0 ? (
                <div className="flex justify-between border-t border-bmw-cardBorder pt-1.5">
                  <span className="text-bmw-muted">الباقي للعميل</span>
                  <span className="tabular text-lg font-bold text-bmw-blue">{formatMoney(receipt.changeDue)}</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
      {printInvoiceId ? <PosInvoicePrintDialog invoiceId={printInvoiceId} onClose={() => setPrintInvoiceId(null)} /> : null}
    </div>
  );
}

function PosInvoicePrintDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { data, error, format, setFormat, state, prepare, print, onAfterPrint } = useInvoicePrint(invoiceId);
  useEffect(() => { void prepare(); }, [prepare]);
  const busy = state === "loading" || state === "printing";
  return <>
    <Modal open onClose={onClose} title="اختيار تنسيق الطباعة" description="اختر نسخة الفاتورة المناسبة للعميل أو الكاشير." size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>إغلاق</Button><Button onClick={() => void print()} loading={busy} disabled={!data}><Printer size={15} /> طباعة الآن</Button></>}>
      <div className="space-y-3">{state === "loading" ? <Alert variant="info">جاري تجهيز الفاتورة للطباعة…</Alert> : null}{error ? <Alert variant="error">{error}</Alert> : null}{data ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{PRINT_FORMATS.map((option) => <button key={option.value} type="button" onClick={() => setFormat(option.value as InvoicePrintFormat)} className={`rounded-xl border px-3 py-3 text-right text-sm ${format === option.value ? "border-bmw-blue bg-bmw-blue/15 text-white" : "border-bmw-cardBorder bg-bmw-carbon text-bmw-silver hover:border-bmw-blue/60"}`}>{option.label}</button>)}</div> : null}</div>
    </Modal>
    {data && state === "printing" ? <PrintContainer data={data} format={format} autoPrint onAfterPrint={onAfterPrint} /> : null}
  </>;
}

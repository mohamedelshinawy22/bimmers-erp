"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  MapPin,
  PackagePlus,
  Pencil,
  Search,
  SlidersHorizontal,
  Boxes,
  ArrowUpDown,
  History,
  ShoppingBag,
  Printer,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, StockBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CURRENCY, formatInt, formatMoney, formatOemNumber } from "@/lib/utils";
import type { PartRow } from "@/server/services/parts.service";
import { adjustStockAction } from "@/server/actions/parts.actions";
import { AddPartModal } from "./components/add-part-modal";
import type { BinOption } from "./components/bin-locator";
import type { ChassisOption, EngineOption } from "./components/fitment-matrix";
import { PurchaseInvoiceModal } from "./components/purchase-invoice-modal";
import { StockLedgerModal } from "./components/stock-ledger-modal";
import { BarcodeThermalLabel } from "@/components/print/templates/barcode-thermal-label";

interface InventoryClientProps {
  rows: PartRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: { query: string; chassis: string; category: string; lowStock: boolean };
  options: {
    brands: Array<{ id: string; name: string; isOem: boolean }>;
    chassis: ChassisOption[];
    engines: EngineOption[];
    bins: BinOption[];
    categories: string[];
  };
  permissions: {
    canWrite: boolean;
    canAdjust: boolean;
    canViewCost: boolean;
    canManageBins: boolean;
    canPurchase: boolean;
    canViewLedger: boolean;
  };
  purchaseOptions: {
    suppliers: Array<{ id: string; name: string; accountNumber: string; currentBalance: number }>;
    treasuries: Array<{ id: string; name: string; currentBalance: number }>;
    taxRatePercent: number;
  };
  openNewOnMount: boolean;
  openPurchaseOnMount: boolean;
}

export function InventoryClient({
  rows,
  total,
  page,
  pageSize,
  filters,
  options,
  permissions,
  purchaseOptions,
  openNewOnMount,
  openPurchaseOnMount,
}: InventoryClientProps) {
  const router = useRouter();
  const params = useSearchParams();

  const [addOpen, setAddOpen] = useState(openNewOnMount);
  const [editPart, setEditPart] = useState<PartRow | null>(null);
  const [adjustPart, setAdjustPart] = useState<PartRow | null>(null);
  const [ledgerPart, setLedgerPart] = useState<PartRow | null>(null);
  const [purchaseOpen, setPurchaseOpen] = useState(openPurchaseOnMount);
  const [query, setQuery] = useState(filters.query);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [barcodePrintOpen, setBarcodePrintOpen] = useState(false);
  const selectedParts = rows.filter((part) => selectedIds.includes(part.id));

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const pushParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    // Any filter change invalidates the current page offset.
    if (!("page" in patch)) next.delete("page");
    router.push(`/inventory?${next.toString()}`);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue">
            <Boxes size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">كتالوج قطع الغيار</h1>
            <p className="text-xs text-bmw-muted">
              {formatInt(total)} صنف مسجّل • بحث فوري بـ pg_trgm على OEM والاسم
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.canPurchase ? (
            <Button variant="outline" onClick={() => setPurchaseOpen(true)}>
              <ShoppingBag size={16} /> فاتورة شراء
            </Button>
          ) : null}
          {selectedParts.length > 0 ? <Button variant="outline" onClick={() => setBarcodePrintOpen(true)}><Printer size={16} /> طباعة ملصقات الباركود ({selectedParts.length})</Button> : null}
          {permissions.canWrite ? (
            <Button onClick={() => setAddOpen(true)}>
              <PackagePlus size={16} /> إدخال صنف جديد
            </Button>
          ) : null}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
          <form
            className="relative md:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              pushParams({ q: query });
            }}
          >
            <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث برقم OEM، الاسم، الباركود، أو رقم الماركة…"
              className="pr-9"
            />
          </form>

          <Select value={filters.chassis} onChange={(e) => pushParams({ chassis: e.target.value })}>
            <option value="">كل أكواد الشاسيه</option>
            {options.chassis.map((c) => (
              <option key={c.id} value={c.code}>
                {c.code} — {c.series}
              </option>
            ))}
          </Select>

          <Select value={filters.category} onChange={(e) => pushParams({ category: e.target.value })}>
            <option value="">كل التصنيفات</option>
            {options.categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>

          <div className="flex items-center gap-2 md:col-span-4">
            <Button
              size="sm"
              variant={filters.lowStock ? "danger" : "outline"}
              onClick={() => pushParams({ lowStock: filters.lowStock ? null : "1" })}
            >
              <SlidersHorizontal size={14} /> النواقص الحرجة فقط
            </Button>
            {(filters.query || filters.chassis || filters.category || filters.lowStock) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setQuery("");
                  router.push("/inventory");
                }}
              >
                مسح الفلاتر
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Catalog */}
      <Card>
        <Table>
          <THead>
            <TR>
              <TH><input aria-label="تحديد الكل" type="checkbox" checked={rows.length > 0 && selectedIds.length === rows.length} onChange={(event) => setSelectedIds(event.target.checked ? rows.map((part) => part.id) : [])}/></TH>
              <TH>رقم OEM</TH>
              <TH>الصنف</TH>
              <TH>الماركة</TH>
              <TH>الموقع</TH>
              <TH>التوافق</TH>
              {permissions.canViewCost ? <TH>التكلفة</TH> : null}
              <TH>قطاعي</TH>
              <TH>جملة</TH>
              <TH>الحد الأدنى</TH>
              <TH>الرصيد</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <EmptyState
                colSpan={permissions.canViewCost ? 12 : 11}
                title="لا توجد أصناف مطابقة"
                description="عدّل معايير البحث أو أضف صنفاً جديداً للكتالوج."
                icon={<Boxes size={32} />}
              />
            ) : (
              rows.map((part) => (
                <TR key={part.id} className={part.isActive ? undefined : "opacity-50"}>
                  <TD><input aria-label={`تحديد ${part.nameAr}`} type="checkbox" checked={selectedIds.includes(part.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, part.id])] : current.filter((id) => id !== part.id))}/></TD>
                  <TD className="whitespace-nowrap font-mono text-xs text-bmw-blue">
                    {formatOemNumber(part.oemNumber)}
                  </TD>
                  <TD className="max-w-[240px]">
                    <p className="truncate font-bold text-white">{part.nameAr}</p>
                    <p className="truncate text-[11px] text-bmw-muted">
                      {[part.category, part.sidePosition].filter(Boolean).join(" • ")}
                    </p>
                  </TD>
                  <TD>
                    <Badge variant={part.isOem ? "oem" : "muted"}>{part.brandName}</Badge>
                  </TD>
                  <TD>
                    {part.binCode ? (
                      <span className="flex items-center gap-1 font-mono text-[11px] text-bmw-blue">
                        <MapPin size={11} /> {part.binCode}
                      </span>
                    ) : (
                      <span className="text-[11px] text-bmw-muted">غير محدد</span>
                    )}
                  </TD>
                  <TD>
                    <div className="flex max-w-[160px] flex-wrap gap-1">
                      {part.chassisCodes.slice(0, 4).map((code) => (
                        <span
                          key={code}
                          className="rounded border border-bmw-cardBorder bg-bmw-carbon px-1.5 font-mono text-[10px] text-bmw-muted"
                        >
                          {code}
                        </span>
                      ))}
                      {part.chassisCodes.length > 4 ? (
                        <span className="font-mono text-[10px] text-bmw-blue">
                          +{part.chassisCodes.length - 4}
                        </span>
                      ) : null}
                      {part.chassisCodes.length === 0 ? (
                        <span className="text-[10px] text-bmw-muted">—</span>
                      ) : null}
                    </div>
                  </TD>
                  {permissions.canViewCost ? (
                    <TD className="tabular whitespace-nowrap text-xs text-bmw-muted">
                      {formatMoney(part.buyPriceAvg)}
                    </TD>
                  ) : null}
                  <TD className="tabular whitespace-nowrap font-bold">{formatMoney(part.sellPriceRetail)}</TD>
                  <TD className="tabular whitespace-nowrap text-bmw-muted">{formatMoney(part.sellPriceWholesale)}</TD>
                  <TD className="tabular whitespace-nowrap text-xs text-amber-400/80">
                    {formatMoney(part.sellPriceMin)}
                  </TD>
                  <TD>
                    <StockBadge quantity={part.stockQuantity} reorderLevel={part.minReorderLevel} />
                  </TD>
                  <TD>
                    <div className="flex items-center gap-1">
                      {permissions.canWrite ? (
                        <button
                          type="button"
                          onClick={() => setEditPart(part)}
                          title="تعديل"
                          className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-bmw-blue/10 hover:text-bmw-blue"
                        >
                          <Pencil size={14} />
                        </button>
                      ) : null}
                      {permissions.canAdjust ? (
                        <button
                          type="button"
                          onClick={() => setAdjustPart(part)}
                          title="تسوية رصيد"
                          className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-amber-500/10 hover:text-amber-400"
                        >
                          <ArrowUpDown size={14} />
                        </button>
                      ) : null}
                      {permissions.canViewLedger ? (
                        <button
                          type="button"
                          onClick={() => setLedgerPart(part)}
                          title="دفتر حركة المخزون"
                          className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-purple-500/10 hover:text-purple-400"
                        >
                          <History size={14} />
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
              <span className="tabular">{pageCount}</span> • {formatInt(total)} صنف
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => pushParams({ page: String(page - 1) })}
              >
                السابق
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pageCount}
                onClick={() => pushParams({ page: String(page + 1) })}
              >
                التالي
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {/* Modals */}
      {permissions.canWrite ? (
        <>
          <AddPartModal
            open={addOpen}
            onClose={() => setAddOpen(false)}
            brands={options.brands}
            chassis={options.chassis}
            engines={options.engines}
            bins={options.bins}
            categories={options.categories}
            canManageBins={permissions.canManageBins}
          />
          {editPart ? (
            <AddPartModal
              key={editPart.id}
              open
              onClose={() => setEditPart(null)}
              brands={options.brands}
              chassis={options.chassis}
              engines={options.engines}
              bins={options.bins}
              categories={options.categories}
              canManageBins={permissions.canManageBins}
              part={editPart}
            />
          ) : null}
        </>
      ) : null}

      {adjustPart ? (
        <AdjustStockModal
          key={adjustPart.id}
          part={adjustPart}
          onClose={() => setAdjustPart(null)}
          canViewCost={permissions.canViewCost}
        />
      ) : null}

      {ledgerPart ? (
        <StockLedgerModal
          key={ledgerPart.id}
          part={ledgerPart}
          onClose={() => setLedgerPart(null)}
          canViewCost={permissions.canViewCost}
        />
      ) : null}

      {barcodePrintOpen ? <BatchBarcodePrintModal parts={selectedParts} onClose={() => setBarcodePrintOpen(false)} /> : null}

      {permissions.canPurchase ? (
        <PurchaseInvoiceModal
          open={purchaseOpen}
          onClose={() => setPurchaseOpen(false)}
          suppliers={purchaseOptions.suppliers}
          treasuries={purchaseOptions.treasuries}
          taxRatePercent={purchaseOptions.taxRatePercent}
        />
      ) : null}
    </div>
  );
}

function BatchBarcodePrintModal({ parts, onClose }: { parts: PartRow[]; onClose: () => void }) {
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(parts.map((part) => [part.id, 1])));
  const labels = parts.flatMap((part) => Array.from({ length: Math.max(0, Math.min(100, counts[part.id] ?? 1)) }, (_, index) => ({ part, index })));
  return <Modal open onClose={onClose} title="طباعة ملصقات الباركود" description="حدّد عدد الملصقات لكل صنف ثم استخدم نافذة الطباعة." size="lg" footer={<><Button variant="ghost" onClick={onClose}>إغلاق</Button><Button onClick={() => window.print()} disabled={!labels.length}><Printer size={16}/>طباعة {labels.length} ملصق</Button></>}><div className="space-y-3"><div className="space-y-2">{parts.map((part) => <label key={part.id} className="flex items-center justify-between rounded-lg border border-bmw-cardBorder p-2 text-sm"><span>{part.nameAr} <span className="font-mono text-bmw-muted">{part.barcode || part.oemNumber}</span></span><Input className="w-20" type="number" min={0} max={100} value={counts[part.id] ?? 1} onChange={(event) => setCounts({ ...counts, [part.id]: Math.trunc(Number(event.target.value) || 0) })}/></label>)}</div><div id="printable-barcode-labels" className="hidden print:block">{labels.map(({ part, index }) => <BarcodeThermalLabel key={`${part.id}-${index}`} storeName="الشافعي لقطع غيار BMW" partName={part.nameAr} code={part.barcode || part.oemNumber} price={formatMoney(part.sellPriceRetail)} />)}</div></div></Modal>;
}

function AdjustStockModal({
  part,
  onClose,
  canViewCost,
}: {
  part: PartRow;
  onClose: () => void;
  canViewCost: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<"MANUAL_ADJUSTMENT" | "STOCKTAKE" | "OPENING_BALANCE">(
    "MANUAL_ADJUSTMENT",
  );
  const [unitCost, setUnitCost] = useState(part.buyPriceAvg > 0 ? String(part.buyPriceAvg) : "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const parsedDelta = Math.trunc(Number(delta) || 0);
  const nextBalance = part.stockQuantity + parsedDelta;
  const isInbound = parsedDelta > 0;
  const parsedCost = Number(unitCost) || 0;
  // Inbound stock must carry a cost, otherwise it is valued at zero and every
  // later sale of those units reports ~100% margin.
  const costMissing = isInbound && parsedCost <= 0;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await adjustStockAction({
        partId: part.id,
        quantityDelta: parsedDelta,
        reason,
        unitCost: isInbound ? parsedCost : undefined,
        note,
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
      title={`تسوية رصيد: ${part.nameAr}`}
      description={`الرصيد الحالي: ${part.stockQuantity} • ${formatOemNumber(part.oemNumber)}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            إلغاء
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={parsedDelta === 0 || nextBalance < 0 || note.trim().length < 3 || costMissing}
          >
            تنفيذ التسوية
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Alert variant="info">
          كل تسوية تُسجَّل في دفتر حركة المخزون وسجل التدقيق ولا يمكن حذفها.
        </Alert>

        <Field label="سبب التسوية" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            <option value="MANUAL_ADJUSTMENT">تسوية يدوية</option>
            <option value="STOCKTAKE">جرد فعلي</option>
            <option value="OPENING_BALANCE">رصيد افتتاحي</option>
          </Select>
        </Field>

        <Field
          label="الكمية (+ إضافة / − خصم)"
          required
          error={nextBalance < 0 ? "الرصيد الناتج سالب" : undefined}
          hint={parsedDelta !== 0 ? `الرصيد بعد التسوية: ${nextBalance}` : "مثال: 5 أو -3"}
        >
          <Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="0" />
        </Field>

        {isInbound ? (
          <Field
            label="تكلفة الوحدة"
            required
            error={costMissing ? "مطلوبة للإضافات — تُستخدم في حساب متوسط التكلفة" : undefined}
            hint={
              canViewCost && part.buyPriceAvg > 0
                ? `متوسط التكلفة الحالي: ${formatMoney(part.buyPriceAvg)} ${CURRENCY}`
                : undefined
            }
          >
            <Input
              type="number"
              min={0}
              step="0.01"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              className={costMissing ? "border-bmw-mRed" : undefined}
            />
          </Field>
        ) : null}

        <Field label="البيان" required hint="٣ أحرف على الأقل — يظهر في سجل التدقيق">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="فرق جرد شهر…" />
        </Field>

        {canViewCost && parsedDelta !== 0 ? (
          <p className="text-[11px] text-bmw-muted">
            قيمة التسوية بالتكلفة:{" "}
            <span className="tabular font-bold text-white">
              {formatMoney(Math.abs(parsedDelta) * (isInbound ? parsedCost : part.buyPriceAvg))} {CURRENCY}
            </span>
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

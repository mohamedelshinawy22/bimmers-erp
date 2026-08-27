"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, SlidersHorizontal } from "lucide-react";
import { Alert, Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { TD, TH, THead, TR, Table, TBody } from "@/components/ui/table";
import { CURRENCY, formatInt, formatMoney } from "@/lib/utils";
import { PRICE_MANAGER_CONFIRMATION, calculateAdjustedProductPrice, type PriceAdjustmentConfig, type PriceAdjustmentRule, type PriceAdjustmentTarget, validateProposedProductPrice } from "@/lib/product-price-adjustment";
import type { PartRow } from "@/server/services/parts.service";
import { applyProductPriceChangesAction } from "@/server/actions/parts.actions";

type Scope = "ALL" | "SELECTED" | "FILTERED";
type EditValues = { cost: number; retail: number; wholesale: number; minimum: number };
const MAX_BATCH_SIZE = 100;

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function marginTone(value: number | null): "success" | "warning" | "danger" | "muted" {
  if (value === null) return "muted";
  if (value >= 20) return "success";
  if (value >= 5) return "warning";
  return "danger";
}

export function PriceAdjustmentModal({ open, onClose, rows, visibleRows, selectedIds, onDone }: {
  open: boolean;
  onClose: () => void;
  rows: PartRow[];
  visibleRows: PartRow[];
  selectedIds: string[];
  onDone: () => void;
}) {
  const [scope, setScope] = useState<Scope>(selectedIds.length ? "SELECTED" : "FILTERED");
  const [target, setTarget] = useState<PriceAdjustmentTarget>("BOTH");
  const [rule, setRule] = useState<PriceAdjustmentRule>("PERCENT_OF_COST");
  const [value, setValue] = useState("15");
  const [roundTo, setRoundTo] = useState<1 | 5 | 10 | 50>(5);
  const [overrides, setOverrides] = useState<Record<string, EditValues>>({});
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ processed: number; updated: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const activeRows = useMemo(() => rows.filter((row) => row.isActive), [rows]);
  const targetRows = useMemo(() => {
    if (scope === "ALL") return activeRows;
    if (scope === "SELECTED") return activeRows.filter((row) => selectedIds.includes(row.id));
    return visibleRows.filter((row) => row.isActive);
  }, [activeRows, scope, selectedIds, visibleRows]);
  const config = useMemo<PriceAdjustmentConfig>(() => ({ target, rule, value: Number(value) || 0, roundTo }), [target, rule, value, roundTo]);
  const preview = useMemo(() => targetRows.map((row) => {
    const calculated = calculateAdjustedProductPrice({ id: row.id, buyPriceAvg: row.buyPriceAvg, sellPriceRetail: row.sellPriceRetail, sellPriceWholesale: row.sellPriceWholesale, sellPriceMin: row.sellPriceMin }, config);
    const editable = overrides[row.id];
    const cost = editable?.cost ?? calculated.buyPriceAvg;
    const retail = editable?.retail ?? calculated.proposedRetail;
    const wholesale = editable?.wholesale ?? calculated.proposedWholesale;
    const minimum = editable?.minimum ?? calculated.proposedMinimum;
    const validationError = validateProposedProductPrice({ cost, retail, wholesale, minimum });
    const marginPercent = cost > 0 ? ((retail - cost) / cost) * 100 : null;
    return { row, calculated, cost, retail, wholesale, minimum, validationError, marginPercent };
  }), [targetRows, config, overrides]);
  const invalidCount = preview.filter((item) => item.validationError).length;
  const averageMargin = preview.length ? preview.reduce((total, item) => total + (item.marginPercent ?? 0), 0) / preview.length : 0;

  const setOverride = (id: string, field: keyof EditValues, raw: string, current: EditValues) => {
    setOverrides((existing) => ({ ...existing, [id]: { ...(existing[id] ?? current), [field]: numberValue(raw) } }));
  };

  const submit = () => {
    setError(null);
    if (!preview.length) { setError("لا توجد أصناف نشطة ضمن نطاق التعديل المختار."); return; }
    if (invalidCount) { setError("صحّح قيم المعاينة غير الصالحة قبل الحفظ."); return; }
    if (confirmation.trim() !== PRICE_MANAGER_CONFIRMATION) { setError(`اكتب عبارة التأكيد التالية كاملة: ${PRICE_MANAGER_CONFIRMATION}`); return; }
    startTransition(async () => {
      let processed = 0;
      let updated = 0;
      try {
        for (let start = 0; start < preview.length; start += MAX_BATCH_SIZE) {
          const chunk = preview.slice(start, start + MAX_BATCH_SIZE);
          const result = await applyProductPriceChangesAction({ confirmation, changes: chunk.map((item) => ({ id: item.row.id, cost: item.cost, retail: item.retail, wholesale: item.wholesale, minimum: item.minimum })) });
          if (!result.success) throw new Error(result.error);
          processed += chunk.length;
          updated += result.data.updated;
          setProgress({ processed, updated });
        }
        onDone();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "تعذر تطبيق تعديل الأسعار.");
      }
    });
  };

  return <Modal open={open} onClose={() => !pending && onClose()} title="تعديل الأسعار" description="راجع كل قيمة قبل الحفظ. لا يتم تغيير أي سعر حتى كتابة عبارة التأكيد واعتماد المعاينة." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button onClick={submit} loading={pending} disabled={!preview.length || invalidCount > 0}><CheckCircle2 size={16} /> حفظ وتطبيق الأسعار الجديدة</Button></>}><div className="space-y-4">
    {error ? <Alert variant="error">{error}</Alert> : null}
    {progress ? <Alert variant="success">تمت معالجة {formatInt(progress.processed)} صنف وتحديث {formatInt(progress.updated)} صنف.</Alert> : null}
    <div className="grid gap-3 md:grid-cols-4">
      <Field label="نطاق التعديل"><Select value={scope} onChange={(event) => { setScope(event.target.value as Scope); setOverrides({}); }}><option value="ALL">كل الأصناف النشطة ({formatInt(activeRows.length)})</option><option value="SELECTED">الأصناف المحددة ({formatInt(selectedIds.length)})</option><option value="FILTERED">النتائج المصفاة حالياً ({formatInt(visibleRows.length)})</option></Select></Field>
      <Field label="السعر المستهدف"><Select value={target} onChange={(event) => setTarget(event.target.value as PriceAdjustmentTarget)}><option value="BOTH">القطاعي والجملة</option><option value="RETAIL">القطاعي فقط</option><option value="WHOLESALE">الجملة فقط</option></Select></Field>
      <Field label="قاعدة التعديل"><Select value={rule} onChange={(event) => setRule(event.target.value as PriceAdjustmentRule)}><option value="PERCENT_OF_COST">هامش على سعر الشراء (%)</option><option value="PERCENT_OF_CURRENT_PRICE">زيادة / خصم من السعر الحالي (%)</option><option value="FIXED_AMOUNT">مبلغ ثابت (+ / - ج.م)</option></Select></Field>
      <Field label={rule === "FIXED_AMOUNT" ? "قيمة التعديل (ج.م)" : "نسبة التعديل (%)"}><Input type="number" step="0.01" value={value} onChange={(event) => { setValue(event.target.value); setOverrides({}); }} /></Field>
      <Field label="التقريب"><Select value={String(roundTo)} onChange={(event) => setRoundTo(Number(event.target.value) as 1 | 5 | 10 | 50)}><option value="1">بدون تقريب</option><option value="5">لأعلى 5 ج.م</option><option value="10">لأعلى 10 ج.م</option><option value="50">لأعلى 50 ج.م</option></Select></Field>
      <div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-xs"><span className="text-bmw-muted">الأصناف المتأثرة</span><p className="mt-1 text-lg font-bold text-white">{formatInt(preview.length)}</p></div>
      <div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-xs"><span className="text-bmw-muted">متوسط هامش القطاعي</span><p className="mt-1 text-lg font-bold text-white">{averageMargin.toFixed(1)}%</p></div>
      <div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 text-xs"><span className="text-bmw-muted">حالات تتطلب تصحيحاً</span><p className="mt-1 text-lg font-bold text-white">{formatInt(invalidCount)}</p></div>
    </div>
    <Alert variant="warning"><SlidersHorizontal className="inline-block" size={15} /> التعديلات اليدوية في الجدول أدناه هي التي ستُحفظ. يحافظ النظام على قاعدة: القطاعي ≥ الجملة ≥ الحد الأدنى ≥ التكلفة.</Alert>
    <div className="max-h-[360px] overflow-auto rounded-xl border border-bmw-cardBorder"><Table><THead className="sticky top-0 z-10 bg-bmw-carbon"><TR><TH>الصنف / OEM</TH><TH>الماركة</TH><TH>التكلفة</TH><TH>القطاعي الحالي</TH><TH>القطاعي الجديد</TH><TH>الجملة الجديدة</TH><TH>الحد الأدنى</TH><TH>الهامش</TH></TR></THead><TBody>{preview.map((item) => { const current = { cost: item.cost, retail: item.retail, wholesale: item.wholesale, minimum: item.minimum }; return <TR key={item.row.id} className={item.validationError ? "bg-red-500/5" : ""}><TD><p className="font-semibold text-white">{item.row.nameAr}</p><p className="font-mono text-[10px] text-bmw-muted">{item.row.oemNumber}</p>{item.calculated.warning ? <p className="mt-1 text-[10px] text-amber-300">{item.calculated.warning}</p> : null}</TD><TD>{item.row.brandName}</TD><TD><Input aria-label={`تكلفة ${item.row.nameAr}`} type="number" min="0" step="0.01" value={item.cost} onChange={(event) => setOverride(item.row.id, "cost", event.target.value, current)} /></TD><TD>{formatMoney(item.row.sellPriceRetail)} {CURRENCY}</TD><TD><Input aria-label={`قطاعي جديد ${item.row.nameAr}`} type="number" min="0" step="0.01" value={item.retail} onChange={(event) => setOverride(item.row.id, "retail", event.target.value, current)} /></TD><TD><Input aria-label={`جملة جديدة ${item.row.nameAr}`} type="number" min="0" step="0.01" value={item.wholesale} onChange={(event) => setOverride(item.row.id, "wholesale", event.target.value, current)} /></TD><TD><Input aria-label={`حد أدنى ${item.row.nameAr}`} type="number" min="0" step="0.01" value={item.minimum} onChange={(event) => setOverride(item.row.id, "minimum", event.target.value, current)} />{item.validationError ? <p className="mt-1 text-[10px] text-red-300">{item.validationError}</p> : null}</TD><TD><Badge variant={marginTone(item.marginPercent)}>{item.marginPercent === null ? "—" : `${item.marginPercent.toFixed(1)}%`}</Badge></TD></TR>; })}</TBody></Table></div>
    <Field label="عبارة التأكيد" required hint={`اكتب: ${PRICE_MANAGER_CONFIRMATION}`}><Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={pending} /></Field>
  </div></Modal>;
}

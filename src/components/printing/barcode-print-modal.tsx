"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
import { Barcode, Minus, Plus, Printer, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { CURRENCY, formatMoney } from "@/lib/utils";

export type BarcodeLabelPart = {
  id: string;
  nameAr: string;
  oemNumber: string;
  barcode?: string | null;
  brandName?: string | null;
  chassisCodes?: string[];
  sellPriceRetail?: number | null;
};

type Symbology = "CODE128" | "EAN13" | "QR";
type FontScale = "SMALL" | "MEDIUM" | "LARGE";
type PresetId = "50X25" | "38X25" | "40X30" | "50X30" | "A4_24" | "A4_30" | "CUSTOM";

type LabelPreset = { id: PresetId; label: string; width: number; height: number; columns?: number; rows?: number };

const PRESETS: LabelPreset[] = [
  { id: "50X25", label: "50 مم × 25 مم — قياسي", width: 50, height: 25 },
  { id: "38X25", label: "38 مم × 25 مم — مدمج", width: 38, height: 25 },
  { id: "40X30", label: "40 مم × 30 مم — متوسط", width: 40, height: 30 },
  { id: "50X30", label: "50 مم × 30 مم — تفصيلي", width: 50, height: 30 },
  { id: "A4_24", label: "A4 — 24 ملصق (3 × 8)", width: 59, height: 34, columns: 3, rows: 8 },
  { id: "A4_30", label: "A4 — 30 ملصق (3 × 10)", width: 59, height: 27, columns: 3, rows: 10 },
  { id: "CUSTOM", label: "مخصص — العرض × الارتفاع", width: 50, height: 25 },
];

const scale = { SMALL: 0.82, MEDIUM: 1, LARGE: 1.18 } as const;
const BARCODE_PREFERENCES_KEY = "bimmererp:barcode-label-preferences:v1";

type BarcodePreferences = {
  presetId: PresetId;
  customWidth: number;
  customHeight: number;
  symbology: Symbology;
  fontScale: FontScale;
  barcodeHeightMm: number;
  lineWidth: number;
  toggles: { company: boolean; partName: boolean; oem: boolean; fitment: boolean; price: boolean; barcode: boolean; barcodeText: boolean };
};

function isPresetId(value: unknown): value is PresetId { return PRESETS.some((preset) => preset.id === value); }
function isSymbology(value: unknown): value is Symbology { return value === "CODE128" || value === "EAN13" || value === "QR"; }
function isFontScale(value: unknown): value is FontScale { return value === "SMALL" || value === "MEDIUM" || value === "LARGE"; }
function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) { const numeric = Number(value); return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback; }

function printableCode(value: string, symbology: Symbology) {
  const fallback = "000000000000";
  if (symbology !== "EAN13") return value || fallback;
  const digits = value.replace(/\D/g, "").slice(0, 12);
  return digits.padEnd(12, "0");
}

function VectorBarcode({ value, symbology, heightMm, lineWidth, showText }: { value: string; symbology: Exclude<Symbology, "QR">; heightMm: number; lineWidth: number; showText: boolean }) {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, printableCode(value, symbology), {
        format: symbology,
        displayValue: false,
        height: Math.max(22, heightMm * 3.78),
        width: Math.max(0.7, lineWidth),
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      JsBarcode(ref.current, "000000000000", { format: "CODE128", displayValue: false, height: Math.max(22, heightMm * 3.78), width: Math.max(0.7, lineWidth), margin: 0 });
    }
  }, [value, symbology, heightMm, lineWidth]);
  return <div className="min-w-0 text-center" dir="ltr"><svg ref={ref} className="h-auto w-full max-w-full" role="img" aria-label="باركود متجهي" />{showText ? <p className="mt-0.5 truncate font-mono text-[0.7em] tracking-wide">{value || "—"}</p> : null}</div>;
}

function BarcodeLabel({ part, company, widthMm, heightMm, showCompany, showPartName, showOem, showFitment, showPrice, showBarcode, showBarcodeText, symbology, fontScale, barcodeHeightMm, lineWidth, className = "" }: {
  part: BarcodeLabelPart; company: { name: string; logoUrl?: string | null }; widthMm: number; heightMm: number; showCompany: boolean; showPartName: boolean; showOem: boolean; showFitment: boolean; showPrice: boolean; showBarcode: boolean; showBarcodeText: boolean; symbology: Symbology; fontScale: FontScale; barcodeHeightMm: number; lineWidth: number; className?: string;
}) {
  const code = part.barcode || part.oemNumber;
  const fitment = [part.brandName, ...(part.chassisCodes ?? []).slice(0, 3)].filter(Boolean).join(" | ");
  const dense = heightMm <= 25;
  return <article className={`barcode-designer-label bg-white text-black ${className}`} dir="rtl" style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, fontSize: `${scale[fontScale]}em` }}>
    {showCompany ? <div className="flex min-h-0 items-center justify-center gap-1 border-b border-black/20 pb-0.5 text-center text-[0.64em] font-bold leading-tight">{company.logoUrl ? <img src={company.logoUrl} alt="" className="h-3 w-auto max-w-8 object-contain" /> : null}<span className="truncate">{company.name}</span></div> : null}
    {showPartName ? <p className={`mt-0.5 overflow-hidden text-center font-bold leading-tight ${dense ? "line-clamp-1 text-[0.78em]" : "line-clamp-2 text-[0.84em]"}`}>{part.nameAr || "صنف بدون اسم"}</p> : null}
    {showOem ? <p className="mt-0.5 text-center font-mono text-[0.86em] font-black tracking-wide" dir="ltr">{part.oemNumber || "—"}</p> : null}
    {showFitment && fitment ? <p className="mt-0.5 truncate text-center text-[0.63em] leading-tight">{fitment}</p> : null}
    {showBarcode ? <div className="mt-auto pt-0.5">{symbology === "QR" ? <div className="flex justify-center"><QRCodeSVG value={code || part.oemNumber || "—"} size={Math.max(42, Math.min(92, heightMm * 2.7))} level="M" includeMargin={false} /></div> : <VectorBarcode value={code} symbology={symbology} heightMm={barcodeHeightMm} lineWidth={lineWidth} showText={showBarcodeText} />}</div> : null}
    {showPrice ? <p className="mt-0.5 text-center text-[0.88em] font-black">{formatMoney(part.sellPriceRetail ?? 0)} {CURRENCY}</p> : null}
  </article>;
}

export function BarcodePrintModal({ parts, company, onClose }: { parts: BarcodeLabelPart[]; company: { name: string; logoUrl?: string | null }; onClose: () => void }) {
  const [presetId, setPresetId] = useState<PresetId>("50X25");
  const [customWidth, setCustomWidth] = useState(50);
  const [customHeight, setCustomHeight] = useState(25);
  const [symbology, setSymbology] = useState<Symbology>("CODE128");
  const [fontScale, setFontScale] = useState<FontScale>("MEDIUM");
  const [barcodeHeightMm, setBarcodeHeightMm] = useState(9);
  const [lineWidth, setLineWidth] = useState(1.15);
  const [isRendering, setIsRendering] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(parts.map((part) => [part.id, 1])));
  const [toggles, setToggles] = useState({ company: true, partName: true, oem: true, fitment: true, price: true, barcode: true, barcodeText: true });
  const [preferencesReady, setPreferencesReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(BARCODE_PREFERENCES_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<BarcodePreferences>;
      if (isPresetId(stored.presetId)) setPresetId(stored.presetId);
      setCustomWidth(boundedNumber(stored.customWidth, 50, 20, 150));
      setCustomHeight(boundedNumber(stored.customHeight, 25, 15, 120));
      if (isSymbology(stored.symbology)) setSymbology(stored.symbology);
      if (isFontScale(stored.fontScale)) setFontScale(stored.fontScale);
      setBarcodeHeightMm(boundedNumber(stored.barcodeHeightMm, 9, 4, 18));
      setLineWidth(boundedNumber(stored.lineWidth, 1.15, 0.7, 2.2));
      if (stored.toggles && typeof stored.toggles === "object") setToggles((current) => ({ ...current, ...Object.fromEntries(Object.entries(current).map(([key, value]) => [key, typeof stored.toggles?.[key as keyof typeof current] === "boolean" ? stored.toggles[key as keyof typeof current] : value])) }));
    } catch (preferenceError) {
      console.warn("[BARCODE_PREFERENCES_READ_ERROR]", preferenceError);
    } finally { setPreferencesReady(true); }
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    const preferences: BarcodePreferences = { presetId, customWidth, customHeight, symbology, fontScale, barcodeHeightMm, lineWidth, toggles };
    try { window.localStorage.setItem(BARCODE_PREFERENCES_KEY, JSON.stringify(preferences)); }
    catch (preferenceError) { console.warn("[BARCODE_PREFERENCES_WRITE_ERROR]", preferenceError); }
  }, [preferencesReady, presetId, customWidth, customHeight, symbology, fontScale, barcodeHeightMm, lineWidth, toggles]);

  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0]!;
  const widthMm = presetId === "CUSTOM" ? Math.max(20, Math.min(150, customWidth)) : preset.width;
  const heightMm = presetId === "CUSTOM" ? Math.max(15, Math.min(120, customHeight)) : preset.height;
  const labels = useMemo(() => parts.flatMap((part) => Array.from({ length: Math.max(0, Math.min(100, Math.trunc(counts[part.id] ?? 1))) }, (_, index) => ({ part, index }))), [parts, counts]);
  const isSheet = Boolean(preset.columns && preset.rows);
  const pageSize = isSheet ? "A4 portrait" : `${widthMm}mm ${heightMm}mm`;
  const css = `@media print { @page { size: ${pageSize}; margin: ${isSheet ? "7mm" : "0"}; } body * { visibility: hidden !important; } #barcode-print-stage, #barcode-print-stage * { visibility: visible !important; } #barcode-print-stage { display: block !important; position: fixed !important; inset: 0 !important; width: auto !important; height: auto !important; overflow: visible !important; background: white !important; z-index: 2147483647 !important; } #barcode-print-stage .barcode-designer-label { box-sizing: border-box !important; overflow: hidden !important; border: 0.15mm solid #222 !important; break-inside: avoid !important; } #barcode-print-stage .barcode-label-roll { page-break-after: always !important; break-after: page !important; } #barcode-print-stage .barcode-label-roll:last-child { page-break-after: auto !important; break-after: auto !important; } #barcode-print-stage .barcode-sheet-grid { display: grid !important; grid-template-columns: repeat(${preset.columns ?? 1}, ${widthMm}mm) !important; grid-auto-rows: ${heightMm}mm !important; gap: 0 !important; align-content: start !important; } }`;
  const toggle = (key: keyof typeof toggles) => setToggles((current) => ({ ...current, [key]: !current[key] }));
  const print = () => {
    if (!labels.length) return;
    setIsRendering(true);
    requestAnimationFrame(() => {
      window.setTimeout(async () => {
        try { await document.fonts?.ready; window.print(); } finally { window.setTimeout(() => setIsRendering(false), 250); }
      }, 350);
    });
  };
  const shared = { company, widthMm, heightMm, showCompany: toggles.company, showPartName: toggles.partName, showOem: toggles.oem, showFitment: toggles.fitment, showPrice: toggles.price, showBarcode: toggles.barcode, showBarcodeText: toggles.barcodeText, symbology, fontScale, barcodeHeightMm, lineWidth };
  return <Modal open onClose={onClose} title="مصمم وطباعة ملصقات الباركود" description="اضبط المقاس والحقول ثم راجع الملصق المتجهي قبل الإرسال للطباعة." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={isRendering}>إغلاق</Button><Button onClick={print} disabled={!labels.length || isRendering}>{isRendering ? <SlidersHorizontal size={16} className="animate-spin" /> : <Printer size={16} />}{isRendering ? "يتم تجهيز SVG للطباعة…" : `طباعة ${labels.length} ملصق`}</Button></>}>
    <style>{css}</style>
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]" dir="rtl">
      <section className="space-y-3 rounded-2xl border border-bmw-cardBorder bg-bmw-carbon/60 p-3"><div className="flex items-center gap-2 font-bold text-white"><Barcode size={17} className="text-bmw-blue" /> إعدادات الملصق</div><Field label="مقاس الملصق"><Select value={presetId} onChange={(event) => setPresetId(event.target.value as PresetId)}>{PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></Field>{presetId === "CUSTOM" ? <div className="grid grid-cols-2 gap-2"><Field label="العرض مم"><Input type="number" min={20} max={150} value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value) || 20)} /></Field><Field label="الارتفاع مم"><Input type="number" min={15} max={120} value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value) || 15)} /></Field></div> : null}<div className="grid grid-cols-2 gap-2"><Field label="نوع الباركود"><Select value={symbology} onChange={(event) => setSymbology(event.target.value as Symbology)}><option value="CODE128">CODE128</option><option value="EAN13">EAN-13</option><option value="QR">QR Code</option></Select></Field><Field label="حجم الخط"><Select value={fontScale} onChange={(event) => setFontScale(event.target.value as FontScale)}><option value="SMALL">صغير</option><option value="MEDIUM">متوسط</option><option value="LARGE">كبير</option></Select></Field></div><label className="grid gap-1 text-xs text-bmw-muted">ارتفاع الباركود: {barcodeHeightMm} مم<Input type="range" min={4} max={18} step={1} value={barcodeHeightMm} onChange={(event) => setBarcodeHeightMm(Number(event.target.value))} /></label><label className="grid gap-1 text-xs text-bmw-muted">سماكة الخطوط: {lineWidth.toFixed(2)}<Input type="range" min={0.7} max={2.2} step={0.05} value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} /></label><div className="grid grid-cols-2 gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-black/20 p-2 text-xs">{([['company','اسم المنشأة / الشعار'],['partName','اسم الصنف'],['oem','رقم OEM'],['fitment','الماركة والتوافق'],['price','السعر والعملة'],['barcode','الباركود'],['barcodeText','الكود أسفل الخطوط']] as const).map(([key, label]) => <label key={key} className="flex items-center gap-1.5"><input type="checkbox" checked={toggles[key]} onChange={() => toggle(key)} />{label}</label>)}</div></section>
      <section className="space-y-3"><div className="rounded-2xl border border-bmw-cardBorder bg-bmw-black/20 p-4"><p className="mb-3 text-sm font-bold text-white">معاينة حية بالحجم النسبي</p><div className="flex min-h-[260px] items-center justify-center overflow-auto rounded-xl bg-[radial-gradient(#475569_1px,transparent_1px)] bg-[size:10px_10px] p-8"><BarcodeLabel part={parts[0] ?? { id: "sample", nameAr: "فانوس أمامي BMW F30", oemNumber: "63117259567", brandName: "BMW", chassisCodes: ["F30", "G20"], sellPriceRetail: 1250 }} {...shared} /></div></div><div className="rounded-2xl border border-bmw-cardBorder bg-bmw-carbon/60 p-3"><p className="mb-2 text-sm font-bold text-white">عدد النسخ لكل صنف</p><div className="max-h-44 space-y-1 overflow-auto">{parts.map((part) => <div key={part.id} className="flex items-center justify-between gap-2 rounded-lg bg-bmw-black/20 p-2 text-xs"><span className="min-w-0 truncate">{part.nameAr} <b className="font-mono text-bmw-blue">{part.oemNumber}</b></span><div className="flex items-center gap-1"><button type="button" onClick={() => setCounts((current) => ({ ...current, [part.id]: Math.max(0, (current[part.id] ?? 1) - 1) }))} className="rounded bg-bmw-card p-1"><Minus size={13}/></button><span className="w-7 text-center tabular">{counts[part.id] ?? 1}</span><button type="button" onClick={() => setCounts((current) => ({ ...current, [part.id]: Math.min(100, (current[part.id] ?? 1) + 1) }))} className="rounded bg-bmw-card p-1"><Plus size={13}/></button></div></div>)}</div></div></section>
    </div>
    <div id="barcode-print-stage" aria-hidden="true" className="pointer-events-none fixed -left-[10000px] top-0 h-px w-px overflow-hidden opacity-0">{isSheet ? <div className="barcode-sheet-grid">{labels.map(({ part, index }) => <BarcodeLabel key={`${part.id}-${index}`} part={part} {...shared} />)}</div> : labels.map(({ part, index }) => <div key={`${part.id}-${index}`} className="barcode-label-roll"><BarcodeLabel part={part} {...shared} /></div>)}</div>
  </Modal>;
}

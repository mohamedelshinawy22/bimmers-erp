"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { QRCodeSVG } from "qrcode.react";
import { Barcode, Minus, Plus, Printer, Settings2, SlidersHorizontal, Type } from "lucide-react";
import { getThermalBarcodeProfileAction, saveThermalBarcodeProfileAction } from "@/server/actions/barcode.actions";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert, Modal } from "@/components/ui/modal";
import { CURRENCY, formatMoney } from "@/lib/utils";
import { DEFAULT_THERMAL_BARCODE_PROFILE, fontCssForThermalFamily, lineWidthForDensity, THERMAL_FONT_FAMILIES, THERMAL_LABEL_PRESETS, thermalBarcodeProfileSchema, type ThermalBarcodeProfile } from "@/lib/thermal-barcode-profile";
import { printThermalLabelsViaIframe } from "@/lib/thermal-printer";

export type BarcodeLabelPart = { id: string; nameAr: string; oemNumber: string; barcode?: string | null; brandName?: string | null; chassisCodes?: string[]; sellPriceRetail?: number | null };
type PrintMode = "quick" | "designer";
const LOCAL_PROFILE_KEY = "bimmererp:thermal-barcode-profile:v1";
const weight = { NORMAL: 400, BOLD: 700, EXTRA_BOLD: 800 } as const;

function codeFor(value: string, symbology: ThermalBarcodeProfile["symbology"]) { return symbology !== "EAN13" ? value || "000000000000" : value.replace(/\D/g, "").slice(0, 12).padEnd(12, "0"); }
function VectorBarcode({ value, profile }: { value: string; profile: ThermalBarcodeProfile }) {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (!ref.current || profile.symbology === "QR") return;
    const render = (format: "CODE128" | "EAN13", code: string) => JsBarcode(ref.current!, code, { format, displayValue: false, height: Math.max(18, profile.barcodeHeightMm * 3.78), width: profile.barcodeDensity, margin: 0, background: "#ffffff", lineColor: "#000000" });
    try { render(profile.symbology, codeFor(value, profile.symbology)); } catch { render("CODE128", "000000000000"); }
  }, [value, profile]);
  return <svg ref={ref} className="universal-thermal-barcode h-auto w-full" style={{ shapeRendering: "crispEdges" }} role="img" aria-label="باركود متجهي"/>;
}

function ThermalLabel({ part, company, profile }: { part: BarcodeLabelPart; company: { name: string; logoUrl?: string | null }; profile: ThermalBarcodeProfile }) {
  const code = part.barcode || part.oemNumber;
  const fitment = [part.brandName, ...(part.chassisCodes ?? []).slice(0, 3)].filter(Boolean).join(" | ");
  const t = profile.toggles;
  const hasLogo = t.showLogo && !!company.logoUrl;
  const hasName = t.showCompanyName && !!company.name;
  const barcodeProfile = !hasLogo ? { ...profile, barcodeHeightMm: Math.min(16, profile.barcodeHeightMm + 2) } : profile;
  const fontFamily = fontCssForThermalFamily(profile.fontFamily);
  const fontWeight = weight[profile.fontWeight];
  return <article className="universal-thermal-label" dir="rtl" style={{ width: `${profile.widthMm}mm`, height: `${profile.heightMm}mm`, fontFamily, fontWeight }}>
    {hasLogo || hasName ? <div className="thermal-company">{hasLogo ? <img src={company.logoUrl!} alt=""/> : null}{hasName ? <span style={{ fontSize: `${profile.companyNameFontSizePt}pt`, fontWeight }}>{company.name}</span> : null}</div> : null}
    {t.partName ? <p className="thermal-part-name" style={{ fontSize: `${profile.partNameFontSizePt}pt`, fontWeight }}>{part.nameAr || "صنف بدون اسم"}</p> : null}
    {t.oem ? <p className="thermal-oem" dir="ltr" style={{ fontSize: `${profile.oemFontSizePt}pt`, fontWeight }}>{part.oemNumber || "—"}</p> : null}
    {t.fitment && fitment ? <p className="thermal-fitment">{fitment}</p> : null}
    {t.barcode ? <div className="thermal-code">{profile.symbology === "QR" ? <QRCodeSVG value={code || "—"} level="M" includeMargin={false} size={Math.max(42, Math.min(120, barcodeProfile.barcodeHeightMm * 6))} style={{ shapeRendering: "crispEdges" }}/> : <VectorBarcode value={code} profile={barcodeProfile}/>} {t.barcodeText ? <p className="thermal-human" dir="ltr" style={{ fontSize: `${profile.barcodeTextSizePt}pt`, fontWeight }}>{code || "—"}</p> : null}</div> : null}
    {t.price ? <p className="thermal-price" style={{ fontSize: `${profile.priceFontSizePt}pt`, fontWeight }}>{formatMoney(part.sellPriceRetail ?? 0)} {CURRENCY}</p> : null}
  </article>;
}

export function BarcodePrintModal({ parts, company, onClose, mode = "quick", profileOverride }: { parts: BarcodeLabelPart[]; company: { name: string; logoUrl?: string | null }; onClose: () => void; mode?: PrintMode; profileOverride?: ThermalBarcodeProfile }) {
  const [profile, setProfile] = useState<ThermalBarcodeProfile>(profileOverride ?? DEFAULT_THERMAL_BARCODE_PROFILE);
  const [ready, setReady] = useState(Boolean(profileOverride));
  const [rendering, setRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(parts.map((part) => [part.id, 1])));
  useEffect(() => {
    if (profileOverride) { setProfile(profileOverride); setReady(true); return; }
    let active = true;
    try {
      const cached = window.localStorage.getItem(LOCAL_PROFILE_KEY);
      if (cached) {
        const parsed = thermalBarcodeProfileSchema.safeParse(JSON.parse(cached));
        if (parsed.success) setProfile(parsed.data);
      }
    } catch {}
    void getThermalBarcodeProfileAction().then((result) => {
      if (!active) return;
      if (result.success) { setProfile(result.data); try { window.localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(result.data)); } catch {} }
      setReady(true);
    });
    return () => { active = false; };
  }, [profileOverride]);
  const labels = useMemo(() => parts.flatMap((part) => Array.from({ length: Math.max(0, Math.min(200, Math.trunc(counts[part.id] ?? 1))) }, (_, index) => ({ part, index }))), [parts, counts]);
  const update = <K extends keyof ThermalBarcodeProfile>(key: K, value: ThermalBarcodeProfile[K]) => setProfile((current) => ({ ...current, [key]: value }));
  const selectPreset = (id: ThermalBarcodeProfile["presetId"]) => { const preset = THERMAL_LABEL_PRESETS.find((item) => item.id === id); setProfile((current) => ({ ...current, presetId: id, ...(preset ? { widthMm: preset.widthMm, heightMm: preset.heightMm } : {}) })); };
  const saveProfile = async () => { setSaving(true); setError(""); const result = await saveThermalBarcodeProfileAction(profile); if (!result.success) setError(result.error); else { try { window.localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile)); } catch {} } setSaving(false); };
  const print = async () => {
    if (!labels.length) return;
    setRendering(true); setError("");
    try {
      await printThermalLabelsViaIframe(labels.map(({ part }) => ({
        companyName: company.name, logoUrl: company.logoUrl, partName: part.nameAr, oemNumber: part.oemNumber, brandAndChassis: [part.brandName, ...(part.chassisCodes ?? []).slice(0, 3)].filter(Boolean).join(" | "), price: part.sellPriceRetail, barcodeValue: part.barcode || part.oemNumber, copies: 1, widthMm: profile.widthMm, heightMm: profile.heightMm, barcodeHeightMm: profile.barcodeHeightMm, barcodeDensity: profile.barcodeDensity, fontSize: profile.fontScale === "SMALL" ? "sm" : profile.fontScale === "LARGE" ? "lg" : "md", fontFamily: profile.fontFamily, companyNameFontSizePt: profile.companyNameFontSizePt, partNameFontSizePt: profile.partNameFontSizePt, oemFontSizePt: profile.oemFontSizePt, priceFontSizePt: profile.priceFontSizePt, barcodeTextSizePt: profile.barcodeTextSizePt, fontWeight: profile.fontWeight, symbology: profile.symbology, enabledFields: { showLogo: profile.toggles.showLogo, showCompanyName: profile.toggles.showCompanyName, partName: profile.toggles.partName, oemNumber: profile.toggles.oem, brandChassis: profile.toggles.fitment, price: profile.toggles.price, barcodeLines: profile.toggles.barcode, barcodeText: profile.toggles.barcodeText },
      })));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تجهيز طباعة الملصقات الحرارية."); } finally { window.setTimeout(() => setRendering(false), 450); }
  };
  return <Modal open onClose={onClose} title={mode === "quick" ? "طباعة ملصقات حرارية" : "ضبط وطباعة الملصقات الحرارية"} description={mode === "quick" ? "يتم استخدام ملف الطابعة الحرارية المحفوظ. عدّل عدد النسخ ثم اطبع فوراً." : "اضبط ملف الطابعة المشترك ثم احفظه لتستخدمه كل محطات العمل."} size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={rendering || saving}>إغلاق</Button>{mode === "designer" ? <Button variant="outline" onClick={() => void saveProfile()} loading={saving}>حفظ ملف الطابعة</Button> : <Button variant="ghost" onClick={() => window.location.assign("/settings/barcode")}><Settings2 size={16}/>ضبط الإعدادات</Button>}<Button onClick={() => void print()} disabled={!labels.length || rendering || !ready}>{rendering ? <SlidersHorizontal size={16} className="animate-spin"/> : <Printer size={16}/>} {rendering ? "يتم تجهيز الطباعة…" : "طباعة فورية"}</Button></>}>
    {error ? <Alert variant="error">{error}</Alert> : null}
    <div className="grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]" dir="rtl">{mode === "designer" ? <Designer profile={profile} onUpdate={update} onPreset={selectPreset}/> : <Copies parts={parts} counts={counts} setCounts={setCounts}/>}<section className="space-y-3"><div className="rounded-2xl border border-bmw-cardBorder bg-bmw-carbon/60 p-3"><p className="mb-2 flex items-center gap-2 text-sm font-bold text-white"><Barcode size={16} className="text-bmw-blue"/>معاينة حرارية فورية</p><div className="flex min-h-[270px] items-center justify-center overflow-auto rounded-xl bg-white p-8"><ThermalLabel part={parts[0] ?? { id: "sample", nameAr: "فانوس أمامي BMW F30", oemNumber: "63117259567", brandName: "BMW", chassisCodes: ["F30", "G20"], sellPriceRetail: 1250 }} company={company} profile={profile}/></div></div>{mode === "designer" ? <Copies parts={parts} counts={counts} setCounts={setCounts}/> : <p className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon/50 p-3 text-xs text-bmw-muted">المقاس: <b className="text-white">{profile.widthMm} × {profile.heightMm} مم</b> · الخط: <b className="text-white">{THERMAL_FONT_FAMILIES.find((item) => item.id === profile.fontFamily)?.label}</b></p>}</section></div>
  </Modal>;
}

function Copies({ parts, counts, setCounts }: { parts: BarcodeLabelPart[]; counts: Record<string, number>; setCounts: React.Dispatch<React.SetStateAction<Record<string, number>>> }) { return <section className="rounded-2xl border border-bmw-cardBorder bg-bmw-carbon/60 p-3"><p className="mb-2 text-sm font-bold text-white">عدد النسخ لكل صنف</p><div className="max-h-48 space-y-1 overflow-auto">{parts.map((part) => <div key={part.id} className="flex items-center justify-between gap-2 rounded-lg bg-bmw-black/20 p-2 text-xs"><span className="min-w-0 truncate">{part.nameAr} <b className="font-mono text-bmw-blue">{part.oemNumber}</b></span><div className="flex items-center gap-1"><button type="button" onClick={() => setCounts((current) => ({ ...current, [part.id]: Math.max(0, (current[part.id] ?? 1) - 1) }))} className="rounded bg-bmw-card p-1"><Minus size={13}/></button><span className="w-7 text-center tabular">{counts[part.id] ?? 1}</span><button type="button" onClick={() => setCounts((current) => ({ ...current, [part.id]: Math.min(200, (current[part.id] ?? 1) + 1) }))} className="rounded bg-bmw-card p-1"><Plus size={13}/></button></div></div>)}</div></section>; }

function TypographySlider({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) { return <label className="grid gap-1 text-xs text-bmw-muted"><span className="flex justify-between gap-2"><span>{label}</span><b className="text-white">{value}{suffix}</b></span><Input type="range" min={min} max={max} step={0.5} value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>; }

function Designer({ profile, onUpdate, onPreset }: { profile: ThermalBarcodeProfile; onUpdate: <K extends keyof ThermalBarcodeProfile>(key: K, value: ThermalBarcodeProfile[K]) => void; onPreset: (value: ThermalBarcodeProfile["presetId"]) => void }) {
  const toggle = (key: keyof ThermalBarcodeProfile["toggles"]) => onUpdate("toggles", { ...profile.toggles, [key]: !profile.toggles[key] });
  return <section className="space-y-3 rounded-2xl border border-bmw-cardBorder bg-bmw-carbon/60 p-3"><div className="flex items-center gap-2 font-bold text-white"><Settings2 size={17} className="text-bmw-blue"/>ملف الطابعة الحرارية</div><Field label="مقاس الملصق"><Select value={profile.presetId} onChange={(event) => onPreset(event.target.value as ThermalBarcodeProfile["presetId"])}>{THERMAL_LABEL_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="CUSTOM">مخصص — العرض × الارتفاع</option></Select></Field>{profile.presetId === "CUSTOM" ? <div className="grid grid-cols-2 gap-2"><Field label="العرض مم"><Input type="number" min={20} max={150} value={profile.widthMm} onChange={(event) => onUpdate("widthMm", Math.max(20, Math.min(150, Number(event.target.value) || 20)))}/></Field><Field label="الارتفاع مم"><Input type="number" min={15} max={180} value={profile.heightMm} onChange={(event) => onUpdate("heightMm", Math.max(15, Math.min(180, Number(event.target.value) || 15)))}/></Field></div> : null}<div className="grid grid-cols-2 gap-2"><Field label="نوع الباركود"><Select value={profile.symbology} onChange={(event) => onUpdate("symbology", event.target.value as ThermalBarcodeProfile["symbology"])}><option value="CODE128">CODE128</option><option value="EAN13">EAN-13</option><option value="QR">QR Code</option></Select></Field><Field label="سُمك خطوط الباركود"><Input type="range" min={1} max={2} step={0.1} value={profile.barcodeDensity} onChange={(event) => onUpdate("barcodeDensity", Number(event.target.value))}/><span className="mt-1 block text-xs text-bmw-muted">{profile.barcodeDensity.toFixed(1)} px</span></Field></div><TypographySlider label="ارتفاع خطوط الباركود" value={profile.barcodeHeightMm} min={4} max={16} suffix=" مم" onChange={(value) => onUpdate("barcodeHeightMm", value)}/><div className="rounded-xl border border-bmw-cardBorder bg-bmw-black/20 p-2"><div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-white"><Type size={14}/>تنسيق الخطوط والأحجام</div><Field label="نوع الخط العربي"><Select value={profile.fontFamily} onChange={(event) => onUpdate("fontFamily", event.target.value as ThermalBarcodeProfile["fontFamily"])}>{THERMAL_FONT_FAMILIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</Select></Field><p className="my-2 rounded bg-white/5 px-2 py-1 text-center text-sm text-white" style={{ fontFamily: fontCssForThermalFamily(profile.fontFamily) }}>معاينة الخط: قطع غيار BMW</p><Field label="سماكة الخط"><Select value={profile.fontWeight} onChange={(event) => onUpdate("fontWeight", event.target.value as ThermalBarcodeProfile["fontWeight"])}><option value="NORMAL">عادي</option><option value="BOLD">عريض</option><option value="EXTRA_BOLD">عريض جداً</option></Select></Field><div className="mt-2 grid gap-2"><TypographySlider label="حجم اسم المنشأة" value={profile.companyNameFontSizePt} min={6} max={14} suffix=" pt" onChange={(value) => onUpdate("companyNameFontSizePt", value)}/><TypographySlider label="حجم اسم الصنف" value={profile.partNameFontSizePt} min={7} max={16} suffix=" pt" onChange={(value) => onUpdate("partNameFontSizePt", value)}/><TypographySlider label="حجم OEM" value={profile.oemFontSizePt} min={6} max={14} suffix=" pt" onChange={(value) => onUpdate("oemFontSizePt", value)}/><TypographySlider label="حجم سعر البيع" value={profile.priceFontSizePt} min={6} max={14} suffix=" pt" onChange={(value) => onUpdate("priceFontSizePt", value)}/><TypographySlider label="حجم كود الباركود الرقمي" value={profile.barcodeTextSizePt} min={5} max={10} suffix=" pt" onChange={(value) => onUpdate("barcodeTextSizePt", value)}/></div></div><div className="grid grid-cols-2 gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-black/20 p-2 text-xs sm:grid-cols-3">{([['showCompanyName','اسم المنشأة نصياً'],['showLogo','شعار المنشأة (Logo)'],['partName','اسم الصنف'],['oem','رقم OEM'],['fitment','الماركة والتوافق'],['price','سعر البيع'],['barcode','خطوط الباركود'],['barcodeText','الكود أسفل الخطوط']] as const).map(([key, label]) => <label key={key} className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={profile.toggles[key]} onChange={() => toggle(key)}/>{label}</label>)}</div><p className="text-[11px] leading-5 text-bmw-muted">تُحفظ هذه المعايرة في ملف الطابعة وتُستخدم تلقائياً في الكتالوج والمشتريات ونقطة البيع.</p></section>;
}

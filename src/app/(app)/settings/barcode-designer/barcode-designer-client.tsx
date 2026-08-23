"use client";

import { useEffect, useState, useTransition } from "react";
import { Barcode, Printer, Save, Search } from "lucide-react";
import { getPrintableBarcodePartsAction, saveBarcodeSettingsAction } from "@/server/actions/barcode.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarcodePrintModal, type BarcodeLabelPart } from "@/components/printing/barcode-print-modal";

const initial = { storeNameText: "Bimmers ERP", labelWidthMm: 46, barcodeHeightMm: 10, topMarginMm: 0, leftMarginMm: 1, fontFamily: "Arial" as const, titleFontSize: 10, partNameFontSize: 9, codeFontSize: 10, priceFontSize: 10, codeType: "BARCODE" as const, priceType: "RETAIL" as const, showPartName: true, showCode: true, showPrice: true, includeTaxInPrice: false, twoLinePartName: false, dualHorizontal: false, dualVertical: false, dualGapMm: 1, targetPrinter: "Xprinter XP-370B" };

export function BarcodeDesignerClient() {
  const [config, setConfig] = useState(initial);
  const [message, setMessage] = useState("");
  const [parts, setParts] = useState<BarcodeLabelPart[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [printOpen, setPrintOpen] = useState(false);
  const numeric = (key: keyof typeof initial, value: string) => setConfig((prev) => ({ ...prev, [key]: Number(value) || 0 }));

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setCatalogError("");
    const timer = window.setTimeout(() => {
      void getPrintableBarcodePartsAction({ query: catalogQuery }).then((result) => {
        if (!active) return;
        if (result.success) setParts(result.data);
        else setCatalogError(result.error);
        setCatalogLoading(false);
      });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [catalogQuery]);

  const save = () => startTransition(async () => {
    const result = await saveBarcodeSettingsAction(config);
    setMessage(result.success ? "تم حفظ الإعدادات." : result.error);
  });

  return <main className="space-y-5" dir="rtl">
    <header><h1 className="text-2xl font-bold text-white">مصمم ملصقات الباركود</h1><p className="text-sm text-bmw-muted">معاينة حرارية حية وإعدادات أبعاد الطابعة وطباعة Code128 من كتالوج المستأجر الحالي.</p></header>
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <section className="bmw-card flex min-h-[460px] items-center justify-center p-8"><div className="bg-white text-black shadow-2xl" style={{ width: `${config.labelWidthMm * 3.78}px`, padding: `${config.topMarginMm * 3.78}px ${config.leftMarginMm * 3.78}px`, fontFamily: config.fontFamily }}><div className="text-center" style={{ fontSize: config.titleFontSize }}>{config.storeNameText}</div>{config.showPartName ? <div className="mt-2 text-center font-bold" style={{ fontSize: config.partNameFontSize }}>اسم الصنف من الكتالوج</div> : null}<div className="mt-3 flex h-20 items-end justify-around bg-[repeating-linear-gradient(90deg,#000_0_2px,#fff_2px_4px,#000_4px_6px,#fff_6px_9px)]"><span className="mb-1 bg-white px-1 text-[9px]" dir="ltr">CODE128</span></div>{config.showCode ? <div className="text-center" dir="ltr" style={{ fontSize: config.codeFontSize }}>OEM / Barcode</div> : null}{config.showPrice ? <div className="mt-1 text-center font-bold" style={{ fontSize: config.priceFontSize }}>سعر البيع</div> : null}</div></section>
      <aside className="bmw-card space-y-3 p-4"><h2 className="flex items-center gap-2 font-bold"><Barcode size={18}/>إعدادات الملصق</h2><label className="grid gap-1 text-xs">اسم المتجر<Input value={config.storeNameText} onChange={(e) => setConfig({ ...config, storeNameText: e.target.value })}/></label><label className="grid gap-1 text-xs">بحث فوري في الكتالوج <span className="text-bmw-muted">(OEM، اسم الصنف، الباركود، E46/F30/G30)</span><span className="relative"><Search className="absolute right-2 top-2.5 text-bmw-muted" size={15}/><Input className="pr-8" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="مثال: F30 أو 51117111741" /></span></label><p className="rounded-lg bg-bmw-black/20 px-2 py-1 text-xs text-bmw-muted">{catalogLoading ? "جارٍ تحديث نتائج الكتالوج…" : `الأصناف المطابقة الجاهزة للطباعة: ${parts.length}`}</p><div className="grid grid-cols-2 gap-2">{([['labelWidthMm','العرض'],['barcodeHeightMm','ارتفاع الباركود'],['topMarginMm','هامش علوي'],['leftMarginMm','هامش أيسر'],['dualGapMm','الفاصل']] as const).map(([key,label]) => <label key={key} className="grid gap-1 text-xs">{label}<Input type="number" value={config[key]} onChange={(e) => numeric(key,e.target.value)}/></label>)}</div><label className="grid gap-1 text-xs">نوع الكود<select className="rounded-lg border border-bmw-cardBorder bg-bmw-black p-2" value={config.codeType} onChange={(e) => setConfig({ ...config, codeType: e.target.value as typeof config.codeType })}><option value="BARCODE">باركود</option><option value="OEM_CODE">OEM</option><option value="ITEM_CODE">SKU</option></select></label><div className="grid gap-2 text-sm">{([['showPartName','إظهار اسم الصنف'],['showCode','إظهار الكود'],['showPrice','إظهار السعر'],['twoLinePartName','اسم بسطرين'],['dualHorizontal','تكرار أفقي'],['dualVertical','تكرار رأسي']] as const).map(([key,label]) => <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={config[key]} onChange={(e) => setConfig({ ...config, [key]: e.target.checked })}/>{label}</label>)}</div><Button type="button" className="w-full" onClick={save} disabled={pending}><Save size={16}/>حفظ الإعدادات</Button><Button type="button" variant="subtle" className="w-full" onClick={() => setPrintOpen(true)} disabled={catalogLoading || parts.length === 0}><Printer size={16}/>{catalogLoading ? "تحميل الكتالوج…" : "فتح مصمم وطباعة SVG"}</Button>{catalogError ? <p className="text-xs text-bmw-mRed">{catalogError}</p> : null}{!catalogLoading && !catalogError && parts.length === 0 ? <p className="text-xs text-bmw-muted">لا توجد أصناف نشطة مطابقة في كتالوج هذا المستأجر.</p> : null}{message ? <p className="text-xs text-bmw-muted">{message}</p> : null}</aside>
    </div>
    {printOpen && parts.length > 0 ? <BarcodePrintModal parts={parts} company={{ name: config.storeNameText }} mode="designer" onClose={() => setPrintOpen(false)} /> : null}
  </main>;
}

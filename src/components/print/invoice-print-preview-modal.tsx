"use client";

import { useEffect, useState } from "react";
import { Download, Printer, Star } from "lucide-react";
import { useInvoicePrint } from "@/hooks/use-invoice-print";
import { PrintContainer, type InvoiceTemplateChoice } from "./print-container";
import { Modal, Alert } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

const templates: Array<{ value: InvoiceTemplateChoice; label: string; description: string }> = [
  { value: "modern", label: "عصري", description: "تصميم ملون ومرتب مع بطاقات الرصيد وQR" },
  { value: "classic", label: "كلاسيكي", description: "نموذج رسمي عالي التباين للطابعات الليزر" },
  { value: "thermal-80mm", label: "حراري 80 مم", description: "إيصال مدمج لطابعات نقاط البيع" },
];

export function InvoicePrintPreviewModal({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { data, error, format, setFormat, template, setTemplate, setDefaultTemplate, state, prepare, print, onAfterPrint } = useInvoicePrint(invoiceId);
  const [showBalance, setShowBalance] = useState(true);
  const [showPartMeta, setShowPartMeta] = useState(true);
  const [message, setMessage] = useState("");
  const busy = state === "loading" || state === "printing";
  useEffect(() => { void prepare(); }, [prepare]);
  const chooseTemplate = (choice: InvoiceTemplateChoice) => { setTemplate(choice); if (choice === "thermal-80mm") setFormat("THERMAL_80"); else if (format === "THERMAL_80" || format === "THERMAL_57") setFormat("A4_STANDARD"); };
  const saveDefault = () => { setDefaultTemplate(template, format); setMessage("تم تثبيت القالب وحجم الورق كإعداد افتراضي على هذا الجهاز."); };
  return <>
    <Modal open onClose={onClose} title="معاينة وطباعة الفاتورة" description="اختر القالب المناسب، راجع المعاينة، ثم اطبع أو احفظ كملف PDF من نافذة الطباعة." size="xl" footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>إغلاق</Button><Button variant="outline" onClick={() => void print()} loading={busy} disabled={!data}><Download size={15} />حفظ PDF / طباعة</Button><Button onClick={() => void print()} loading={busy} disabled={!data}><Printer size={15} />طباعة الآن</Button></>}>
      <div className="space-y-4" dir="rtl">
        {state === "loading" ? <Alert variant="info">جاري تجهيز بيانات الفاتورة والمعاينة…</Alert> : null}
        {error ? <Alert variant="error">{error}</Alert> : null}
        {message ? <Alert variant="success">{message}</Alert> : null}
        {data && state !== "printing" ? <><section className="grid gap-2 sm:grid-cols-3">{templates.map((item) => <button key={item.value} type="button" onClick={() => chooseTemplate(item.value)} className={`rounded-xl border p-3 text-right transition-colors ${template === item.value ? "border-bmw-blue bg-bmw-blue/15 text-white" : "border-bmw-cardBorder bg-bmw-carbon text-bmw-silver hover:border-bmw-blue/60"}`}><p className="font-bold">{item.label}</p><p className="mt-1 text-[11px] opacity-80">{item.description}</p></button>)}</section>
          <section className="flex flex-wrap items-center gap-4 rounded-xl border border-bmw-cardBorder bg-bmw-black/30 p-3 text-sm"><label className="flex items-center gap-2">حجم الورق <Select value={format} onChange={(event) => setFormat(event.target.value as typeof format)} className="w-36"><option value="A4_STANDARD">A4</option><option value="THERMAL_80">80mm</option></Select></label><label className="flex items-center gap-2"><input type="checkbox" checked={showBalance} onChange={(event) => setShowBalance(event.target.checked)} /> إظهار الرصيد السابق</label><label className="flex items-center gap-2"><input type="checkbox" checked={showPartMeta} onChange={(event) => setShowPartMeta(event.target.checked)} /> إظهار OEM والماركة</label><Button size="sm" variant="subtle" onClick={saveDefault}><Star size={14} />تثبيت كقالب افتراضي</Button></section>
          <section className="max-h-[52vh] overflow-auto rounded-xl border border-bmw-cardBorder bg-slate-200 p-3"><div className="origin-top scale-[0.72] rounded bg-white shadow-xl" style={{ width: "138%" }}><PrintContainer data={data} format={format} template={template} showBalance={showBalance} showPartMeta={showPartMeta} /></div></section>
        </> : null}
      </div>
    </Modal>
    {data && state === "printing" ? <PrintContainer data={data} format={format} template={template} showBalance={showBalance} showPartMeta={showPartMeta} autoPrint onAfterPrint={onAfterPrint} /> : null}
  </>;
}

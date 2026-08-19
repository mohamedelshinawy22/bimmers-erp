"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, Printer, Star } from "lucide-react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  UNIVERSAL_PRINT_TEMPLATES,
  type PrintDocumentType,
  type UniversalPrintOptions,
  type UniversalPrintTemplate,
  printTemplateStorageKey,
} from "./universal-print-types";

interface UniversalPrintModalProps {
  documentType: PrintDocumentType;
  title: string;
  description: string;
  onClose: () => void;
  renderDocument: (options: UniversalPrintOptions) => ReactNode;
  showBalanceToggle?: boolean;
  showPartMetaToggle?: boolean;
}

const validTemplates: UniversalPrintTemplate[] = ["modern", "classic", "thermal-80mm"];

export function UniversalPrintModal({
  documentType,
  title,
  description,
  onClose,
  renderDocument,
  showBalanceToggle = true,
  showPartMetaToggle = true,
}: UniversalPrintModalProps) {
  const [template, setTemplate] = useState<UniversalPrintTemplate>("modern");
  const [showBalance, setShowBalance] = useState(true);
  const [showPartMeta, setShowPartMeta] = useState(true);
  const [printRequested, setPrintRequested] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(printTemplateStorageKey(documentType)) as UniversalPrintTemplate | null;
    if (saved && validTemplates.includes(saved)) setTemplate(saved);
  }, [documentType]);

  const options = useMemo<UniversalPrintOptions>(() => ({ template, showBalance, showPartMeta }), [template, showBalance, showPartMeta]);
  const paperLabel = template === "thermal-80mm" ? "رول حراري 80 مم" : "A4";

  useEffect(() => {
    if (!printRequested) return;
    let active = true;
    const afterPrint = () => setPrintRequested(false);
    const print = async () => {
      await document.fonts?.ready;
      const images = Array.from(document.querySelectorAll<HTMLImageElement>(".universal-print-root img"));
      await Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.onload = () => resolve(); image.onerror = () => resolve(); })));
      if (active) window.print();
    };
    window.addEventListener("afterprint", afterPrint);
    void print();
    return () => { active = false; window.removeEventListener("afterprint", afterPrint); };
  }, [printRequested, options]);

  const saveDefault = () => {
    window.localStorage.setItem(printTemplateStorageKey(documentType), template);
    setMessage("تم تثبيت القالب الافتراضي لهذا النوع من المستندات على هذا الجهاز.");
  };

  return <>
    <Modal
      open
      onClose={onClose}
      title={title}
      description={description}
      size="xl"
      footer={<><Button variant="ghost" onClick={onClose} disabled={printRequested}>إغلاق</Button><Button variant="outline" onClick={() => setPrintRequested(true)} disabled={printRequested}><Download size={15} />حفظ PDF</Button><Button onClick={() => setPrintRequested(true)} loading={printRequested}><Printer size={15} />طباعة الآن</Button></>}
    >
      <div className="space-y-4" dir="rtl">
        {message ? <Alert variant="success">{message}</Alert> : null}
        <section className="grid gap-2 sm:grid-cols-3">
          {UNIVERSAL_PRINT_TEMPLATES.map((item) => <button key={item.value} type="button" onClick={() => setTemplate(item.value)} className={`rounded-xl border p-3 text-right transition-colors ${template === item.value ? "border-bmw-blue bg-bmw-blue/15 text-white" : "border-bmw-cardBorder bg-bmw-carbon text-bmw-silver hover:border-bmw-blue/60"}`}><p className="font-bold">{item.label}</p><p className="mt-1 text-[11px] opacity-80">{item.description}</p></button>)}
        </section>
        <section className="flex flex-wrap items-center gap-4 rounded-xl border border-bmw-cardBorder bg-bmw-black/30 p-3 text-sm">
          <span>حجم الورق: <b className="text-bmw-blue">{paperLabel}</b></span>
          {showBalanceToggle ? <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showBalance} onChange={(event) => setShowBalance(event.target.checked)} />إظهار الرصيد السابق والملخص المالي</label> : null}
          {showPartMetaToggle ? <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={showPartMeta} onChange={(event) => setShowPartMeta(event.target.checked)} />إظهار OEM والماركة والتفاصيل</label> : null}
          <Button size="sm" variant="subtle" onClick={saveDefault}><Star size={14} />تثبيت كقالب افتراضي</Button>
        </section>
        <section className="max-h-[52vh] overflow-auto rounded-xl border border-bmw-cardBorder bg-slate-200 p-3">
          <div className="origin-top rounded bg-white shadow-xl" style={{ transform: "scale(0.72)", width: "138%", transformOrigin: "top right" }}>
            {renderDocument(options)}
          </div>
        </section>
      </div>
    </Modal>
    {printRequested ? <div className={`universal-print-root ${template === "thermal-80mm" ? "print-format-thermal_80" : "print-format-a4"}`}>{renderDocument(options)}</div> : null}
  </>;
}

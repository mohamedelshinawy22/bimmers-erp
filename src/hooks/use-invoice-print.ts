"use client";

import { useCallback, useEffect, useState } from "react";
import { getInvoicePrintDataAction } from "@/server/actions/invoice-print.actions";
import type { InvoicePrintData, InvoicePrintFormat } from "@/lib/invoice-print-types";
import type { InvoiceTemplateChoice } from "@/components/print/print-container";
import { formatOemNumber } from "@/lib/utils";

const TEMPLATE_STORAGE_KEY = "bimmer_print_template_invoice";
const FORMAT_STORAGE_KEY = "bimmer_print_paper_invoice";
const validTemplates: InvoiceTemplateChoice[] = ["modern", "classic", "thermal-80mm"];
const validFormats: InvoicePrintFormat[] = ["A4_STANDARD", "A5", "THERMAL_80", "THERMAL_57", "E_INVOICE"];

export function useInvoicePrint(invoiceId?: string) {
  const [data, setData] = useState<InvoicePrintData | null>(null);
  const [format, setFormat] = useState<InvoicePrintFormat>(() => { if (typeof window === "undefined") return "A4_STANDARD"; const saved = window.localStorage.getItem(FORMAT_STORAGE_KEY) as InvoicePrintFormat | null; return saved && validFormats.includes(saved) ? saved : "A4_STANDARD"; });
  const [template, setTemplate] = useState<InvoiceTemplateChoice>(() => { if (typeof window === "undefined") return "modern"; const saved = window.localStorage.getItem(TEMPLATE_STORAGE_KEY) as InvoiceTemplateChoice | null; return saved && validTemplates.includes(saved) ? saved : "modern"; });
  const [state, setState] = useState<"idle" | "loading" | "ready" | "printing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const prepare = useCallback(async () => {
    if (!invoiceId) return null;
    setState("loading"); setError(null);
    const result = await getInvoicePrintDataAction(invoiceId);
    if (!result.success) { setState("error"); setError(result.error); return null; }
    const normalized = { ...result.data, lines: result.data.lines.map((line) => ({ ...line, oemNumber: formatOemNumber(line.oemNumber) })) };
    setData(normalized); setState("ready"); return normalized;
  }, [invoiceId]);
  const print = useCallback(async () => { const ready = data ?? await prepare(); if (ready) setState("printing"); }, [data, prepare]);
  const closePreview = useCallback(() => { setState("idle"); setData(null); }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p" && invoiceId) { event.preventDefault(); void print(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [invoiceId, print]);
  const setDefaultTemplate = useCallback((nextTemplate: InvoiceTemplateChoice, nextFormat: InvoicePrintFormat) => { window.localStorage.setItem(TEMPLATE_STORAGE_KEY, nextTemplate); window.localStorage.setItem(FORMAT_STORAGE_KEY, nextFormat); setTemplate(nextTemplate); setFormat(nextFormat); }, []);
  return { data, format, setFormat, template, setTemplate, setDefaultTemplate, state, error, prepare, print, closePreview, onAfterPrint: () => setState("ready") };
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { getInvoicePrintDataAction } from "@/server/actions/invoice-print.actions";
import type { InvoicePrintData, InvoicePrintFormat } from "@/lib/invoice-print-types";

export function useInvoicePrint(invoiceId?: string) {
  const [data, setData] = useState<InvoicePrintData | null>(null);
  const [format, setFormat] = useState<InvoicePrintFormat>("A4_STANDARD");
  const [state, setState] = useState<"idle" | "loading" | "ready" | "printing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const prepare = useCallback(async () => {
    if (!invoiceId) return null;
    setState("loading"); setError(null);
    const result = await getInvoicePrintDataAction(invoiceId);
    if (!result.success) { setState("error"); setError(result.error); return null; }
    setData(result.data); setState("ready"); return result.data;
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
  return { data, format, setFormat, state, error, prepare, print, closePreview, onAfterPrint: () => setState("ready") };
}

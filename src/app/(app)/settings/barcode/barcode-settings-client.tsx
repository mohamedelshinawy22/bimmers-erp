"use client";

import { useState } from "react";
import { Barcode, Printer, Settings2 } from "lucide-react";
import { BarcodePrintModal } from "@/components/printing/barcode-print-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BarcodeSettingsClient({ company }: { company: { name: string; logoUrl?: string | null } }) {
  const [open, setOpen] = useState(false);
  const sample = [{ id: "thermal-calibration-sample", nameAr: "ملصق اختبار معايرة حراري", oemNumber: "BMW-THERMAL-50X25", barcode: "BMW-THERMAL-50X25", brandName: "BMW", chassisCodes: ["F30", "G20"], sellPriceRetail: 1250 }];
  return <main className="space-y-5" dir="rtl"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-white">إعدادات طباعة الباركود الحرارية</h1><p className="text-sm text-bmw-muted">ملف طابعة موحّد عالي التباين لجميع محطات العمل والطابعات الحرارية.</p></div><Button onClick={() => setOpen(true)}><Settings2 size={16}/> فتح مركز المعايرة</Button></header><Card><CardHeader><CardTitle><Barcode size={18} className="text-bmw-blue"/> ملف الطابعة الحرارية المشترك</CardTitle></CardHeader><CardContent className="space-y-4"><p className="max-w-3xl text-sm leading-7 text-bmw-silver">اضبط المقاس الفعلي للملصق، التباين، نوع الباركود، كثافة الخطوط والحقول مرة واحدة. تُحفظ المعايرة في قاعدة بيانات الشركة مع نسخة احتياطية محلية، وتُستخدم تلقائياً في الكتالوج والمشتريات ونقطة البيع.</p><div className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-bmw-cardBorder bg-bmw-black/20 p-3"><p className="text-xs text-bmw-muted">مقاسات مدعومة</p><b className="mt-1 block text-white">38×25 حتى 100×150 مم</b></div><div className="rounded-xl border border-bmw-cardBorder bg-bmw-black/20 p-3"><p className="text-xs text-bmw-muted">توافق حراري</p><b className="mt-1 block text-white">203 / 300 DPI · رول مستمر أو فواصل</b></div><div className="rounded-xl border border-bmw-cardBorder bg-bmw-black/20 p-3"><p className="text-xs text-bmw-muted">وضع الإخراج</p><b className="mt-1 block text-white">أسود خالص على أبيض خالص</b></div></div><div className="flex flex-wrap gap-2"><Button onClick={() => setOpen(true)}><Settings2 size={16}/> ضبط الإعدادات وحفظها</Button><Button variant="outline" onClick={() => setOpen(true)}><Printer size={16}/> طباعة ملصق تجريبي معاير</Button></div></CardContent></Card>{open ? <BarcodePrintModal parts={sample} company={company} mode="designer" onClose={() => setOpen(false)} /> : null}</main>;
}

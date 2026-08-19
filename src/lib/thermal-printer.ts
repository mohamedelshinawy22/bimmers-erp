import type { ThermalBarcodeProfile } from "@/lib/thermal-barcode-profile";

export interface ThermalLabelData {
  companyName?: string;
  logoUrl?: string | null;
  partName: string;
  oemNumber: string;
  brandAndChassis?: string;
  price?: number | null;
  barcodeValue: string;
  copies?: number;
  widthMm: number;
  heightMm: number;
  barcodeHeightMm?: number;
  barcodeDensity?: number;
  fontSize?: "sm" | "md" | "lg";
  symbology?: ThermalBarcodeProfile["symbology"];
  enabledFields: {
    companyHeader: boolean;
    partName: boolean;
    oemNumber: boolean;
    brandChassis: boolean;
    price: boolean;
    barcodeLines: boolean;
    barcodeText: boolean;
  };
}

const escapeHtml = (value: string | number | null | undefined) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
const validLogoUrl = (value: string | null | undefined) => value && /^(https?:|data:image\/(?:png|jpe?g|webp|svg\+xml);base64,)/i.test(value) ? value : "";
const codeFor = (value: string, symbology: ThermalBarcodeProfile["symbology"]) => symbology === "EAN13" ? value.replace(/\D/g, "").slice(0, 12).padEnd(12, "0") : value || "000000000000";

async function vectorCode(value: string, symbology: ThermalBarcodeProfile["symbology"], height: number, width: number): Promise<string> {
  if (symbology === "QR") {
    const [{ QRCodeSVG }, React, { createRoot }] = await Promise.all([import("qrcode.react"), import("react"), import("react-dom/client")]);
    const host = document.createElement("div");
    const root = createRoot(host);
    root.render(React.createElement(QRCodeSVG, { value: value || "—", level: "M", includeMargin: false, size: Math.max(42, Math.min(160, height * 5)), fgColor: "#000000", bgColor: "#ffffff" }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const markup = host.innerHTML;
    root.unmount();
    return markup;
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const JsBarcode = (await import("jsbarcode")).default;
  const renderFallback = () => JsBarcode(svg, "000000000000", { format: "CODE128", displayValue: false, height: Math.max(18, height * 3.78), width, margin: 0, lineColor: "#000000", background: "#ffffff" });
  try { JsBarcode(svg, codeFor(value, symbology), { format: symbology, displayValue: false, height: Math.max(18, height * 3.78), width, margin: 0, lineColor: "#000000", background: "#ffffff" }); }
  catch { renderFallback(); }
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  return svg.outerHTML;
}

const fontPoint = (size: ThermalLabelData["fontSize"]) => size === "lg" ? "9pt" : size === "sm" ? "6.5pt" : "7.5pt";

async function labelHtml(data: ThermalLabelData): Promise<string> {
  const widthMm = Math.min(150, Math.max(20, Number(data.widthMm) || 50));
  const heightMm = Math.min(180, Math.max(15, Number(data.heightMm) || 25));
  const barcodeHeightMm = Math.min(14, Math.max(4, Number(data.barcodeHeightMm) || 9));
  const density = Math.min(2, Math.max(0.5, Number(data.barcodeDensity) || 1.2));
  const symbology = data.symbology ?? "CODE128";
  const barcode = data.enabledFields.barcodeLines && data.barcodeValue ? await vectorCode(data.barcodeValue.trim(), symbology, barcodeHeightMm, density) : "";
  const logo = validLogoUrl(data.logoUrl);
  const copyCount = Math.min(200, Math.max(1, Math.trunc(Number(data.copies) || 1)));
  const field = data.enabledFields;
  const header = field.companyHeader && (logo || data.companyName) ? `<div class="header-row">${logo ? `<img src="${escapeHtml(logo)}" class="logo" alt="" />` : ""}${data.companyName ? `<span class="company-title">${escapeHtml(data.companyName)}</span>` : ""}</div>` : "";
  const one = `<section class="label-page" style="width:${widthMm}mm;height:${heightMm}mm;max-width:${widthMm}mm;max-height:${heightMm}mm" dir="rtl">${header}${field.partName ? `<div class="part-name" style="font-size:${fontPoint(data.fontSize)}">${escapeHtml(data.partName)}</div>` : ""}<div class="middle-row">${field.oemNumber ? `<span class="oem-num" dir="ltr">${escapeHtml(data.oemNumber)}</span>` : ""}${field.brandChassis && data.brandAndChassis ? `<span class="chassis-tag">${escapeHtml(data.brandAndChassis)}</span>` : ""}</div>${field.price && data.price != null ? `<div class="price-row">${escapeHtml(Number(data.price).toLocaleString("en-US", { maximumFractionDigits: 2 }))} ج.م</div>` : ""}${barcode ? `<div class="barcode-wrapper" style="max-height:${barcodeHeightMm}mm">${barcode}</div>` : ""}${field.barcodeText && data.barcodeValue ? `<div class="barcode-text" dir="ltr">${escapeHtml(data.barcodeValue)}</div>` : ""}</section>`;
  return Array.from({ length: copyCount }, () => one).join("");
}

export async function printThermalLabelsViaIframe(input: ThermalLabelData | ThermalLabelData[]): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") throw new Error("لا تتوفر الطباعة الحرارية خارج المتصفح.");
  const labels = Array.isArray(input) ? input : [input];
  if (!labels.length) throw new Error("لا توجد ملصقات للطباعة.");
  const html = await Promise.all(labels.map(labelHtml));
  const [first] = labels;
  if (!first) throw new Error("لا توجد ملصقات للطباعة.");
  const widthMm = Math.min(150, Math.max(20, Number(first.widthMm) || 50));
  const heightMm = Math.min(180, Math.max(15, Number(first.heightMm) || 25));
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "طباعة ملصقات الباركود الحرارية");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { iframe.remove(); throw new Error("تعذر إنشاء مستند الطباعة المعزول."); }
  const cleanup = () => window.setTimeout(() => iframe.remove(), 1000);
  const allHtml = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>طباعة ملصقات الباركود</title><style>@page{size:${widthMm}mm ${heightMm}mm;margin:0!important}*{box-sizing:border-box!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}html,body{margin:0!important;padding:0!important;width:${widthMm}mm!important;background:#ffffff!important;color:#000000!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif!important}.label-page{page-break-after:always!important;break-after:page!important;page-break-inside:avoid!important;break-inside:avoid!important;display:flex!important;flex-direction:column!important;justify-content:space-between!important;align-items:center!important;text-align:center!important;padding:1.5mm 1mm!important;background:#ffffff!important;color:#000000!important;overflow:hidden!important}.label-page:last-child{page-break-after:auto!important;break-after:auto!important}.header-row{display:flex;align-items:center;justify-content:center;gap:2mm;max-height:4.5mm;min-height:0}.logo{max-height:4mm;width:auto;max-width:18mm;object-fit:contain;filter:grayscale(1) contrast(3)}.company-title{font-size:7pt;font-weight:800;color:#000000}.part-name{font-weight:900;color:#000000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;line-height:1.1}.middle-row{display:flex;justify-content:space-between;align-items:center;gap:1mm;width:100%;padding:0 1mm}.oem-num{font-size:8pt;font-weight:900;font-family:monospace;color:#000000;letter-spacing:.3px}.chassis-tag{font-size:6.5pt;font-weight:800;color:#000000;border:.3mm solid #000000;padding:0 1mm;border-radius:1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.price-row{font-size:8pt;font-weight:900;color:#000000}.barcode-wrapper{display:flex;align-items:center;justify-content:center;width:100%;overflow:hidden}.barcode-wrapper svg{display:block;max-width:96%;height:auto;shape-rendering:crispEdges}.barcode-text{font-size:6.5pt;font-family:monospace;font-weight:800;color:#000000;letter-spacing:.5px;line-height:1}</style></head><body>${html.join("")}</body></html>`;
  doc.open(); doc.write(allHtml); doc.close();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
  await doc.fonts?.ready;
  const images = Array.from(doc.images);
  await Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => { image.addEventListener("load", () => resolve(), { once: true }); image.addEventListener("error", () => resolve(), { once: true }); })));
  const frameWindow = iframe.contentWindow;
  if (!frameWindow) { iframe.remove(); throw new Error("تعذر الوصول إلى نافذة الطباعة المعزولة."); }
  frameWindow.addEventListener("afterprint", cleanup, { once: true });
  frameWindow.focus();
  frameWindow.print();
  window.setTimeout(cleanup, 60000);
}

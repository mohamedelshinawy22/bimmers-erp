"use client";

import { QRCodeSVG } from "qrcode.react";

export function InvoiceQrCode({ value }: { value: string }) {
  return <QRCodeSVG value={value} size={88} level="M" includeMargin aria-label="رمز التحقق من الفاتورة" />;
}

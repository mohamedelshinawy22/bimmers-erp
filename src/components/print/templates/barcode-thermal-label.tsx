type BarcodeThermalLabelProps = { storeName: string; partName: string; code: string; price?: string; widthMm?: number };

export function BarcodeThermalLabel({ storeName, partName, code, price, widthMm = 46 }: BarcodeThermalLabelProps) {
  return <article className="barcode-print-root" dir="rtl" style={{ width: `${widthMm}mm` }}><strong>{storeName}</strong><b>{partName}</b><div className="barcode-bars"><span dir="ltr">{code}</span></div><small dir="ltr">{code}</small>{price ? <strong>{price}</strong> : null}</article>;
}

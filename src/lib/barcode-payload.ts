export type PrintableSymbology = "CODE128" | "EAN13" | "QR";

/**
 * Provides a stable printable payload without modifying the tenant-owned item
 * identifier. EAN-13 needs twelve numeric input digits; Code128 supports the
 * OEM/part-number strings used by the Bimmers catalog.
 */
export function barcodePayloadValue(value: string | null | undefined, symbology: PrintableSymbology) {
  const code = value?.trim() ?? "";
  if (symbology === "EAN13") return code.replace(/\D/g, "").slice(0, 12).padEnd(12, "0");
  return code || "000000000000";
}

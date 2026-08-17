import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Operator-editable configuration. Cached per request via React `cache` is not
 * used here on purpose: settings are read inside transactions where a stale
 * value could change business behaviour mid-flight.
 */
export async function getSetting(key: string, fallback: string): Promise<string> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    return row?.value ?? fallback;
  } catch {
    // Settings table unreachable → fail safe on the conservative default.
    return fallback;
  }
}

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await prisma.systemSetting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSettingsGrouped(): Promise<
  Array<{ group: string; items: Array<{ key: string; label: string; value: string }> }>
> {
  const rows = await prisma.systemSetting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
  const map = new Map<string, Array<{ key: string; label: string; value: string }>>();
  for (const r of rows) {
    const bucket = map.get(r.group) ?? [];
    bucket.push({ key: r.key, label: r.label, value: r.value });
    map.set(r.group, bucket);
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }));
}

const FALLBACK_CATEGORIES = [
  "الفرامل",
  "التعليق والمقصات",
  "المحرك",
  "الكهرباء والإشعال",
  "التبريد والرادياتير",
  "ناقل الحركة",
  "العفشة والمساعدين",
  "الفلاتر والزيوت",
  "الهيكل والصدامات",
  "التكييف",
];

export async function getPartCategories(): Promise<string[]> {
  const raw = await getSetting("PART_CATEGORIES", "");
  if (!raw) return FALLBACK_CATEGORIES;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as string[]) : FALLBACK_CATEGORIES;
  } catch {
    return FALLBACK_CATEGORIES;
  }
}

export interface CompanyProfile {
  name: string;
  phone: string;
  address: string;
  taxNumber: string;
  invoiceFooter: string;
}

/**
 * Company identity for printable documents.
 *
 * These keys were seeded and editable but read nowhere, so an admin could change
 * the phone or tax number, see "saved successfully", and have nothing change.
 * They are now rendered on the invoice/receipt header and footer.
 */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  const rows = await prisma.systemSetting.findMany({
    where: {
      key: { in: ["COMPANY_NAME", "COMPANY_PHONE", "COMPANY_ADDRESS", "TAX_NUMBER", "INVOICE_FOOTER"] },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    name: map.get("COMPANY_NAME") ?? "BimmerERP",
    phone: map.get("COMPANY_PHONE") ?? "",
    address: map.get("COMPANY_ADDRESS") ?? "",
    taxNumber: map.get("TAX_NUMBER") ?? "",
    invoiceFooter: map.get("INVOICE_FOOTER") ?? "",
  };
}

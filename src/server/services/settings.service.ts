import "server-only";
import { prisma } from "@/lib/prisma";

type SettingsDb = Pick<typeof prisma, "systemSetting">;

/**
 * Operator-editable configuration. Cached per request via React `cache` is not
 * used here on purpose: settings are read inside transactions where a stale
 * value could change business behaviour mid-flight.
 */
export async function getSetting(key: string, fallback: string, db: SettingsDb = prisma): Promise<string> {
  try {
    const row = await db.systemSetting.findUnique({ where: { key }, select: { value: true } });
    return row?.value ?? fallback;
  } catch {
    // Settings table unreachable → fail safe on the conservative default.
    return fallback;
  }
}

export async function getSettings(db: SettingsDb = prisma): Promise<Record<string, string>> {
  const rows = await db.systemSetting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSettingsGrouped(db: SettingsDb = prisma): Promise<
  Array<{ group: string; items: Array<{ key: string; label: string; value: string }> }>
> {
  const rows = await db.systemSetting.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
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

export async function getPartCategories(db: SettingsDb = prisma): Promise<string[]> {
  const raw = await getSetting("PART_CATEGORIES", "", db);
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
  commercialName: string;
  phone: string;
  phonePrimary: string;
  phoneSecondary: string;
  address: string;
  taxNumber: string;
  commercialRegister: string;
  logoUrl: string;
  invoiceFooter: string;
}

/**
 * Company identity for printable documents.
 *
 * These keys were seeded and editable but read nowhere, so an admin could change
 * the phone or tax number, see "saved successfully", and have nothing change.
 * They are now rendered on the invoice/receipt header and footer.
 */
export async function getCompanyProfile(db: SettingsDb = prisma): Promise<CompanyProfile> {
  const rows = await db.systemSetting.findMany({
    where: {
      key: { in: ["COMPANY_NAME", "COMMERCIAL_NAME", "COMPANY_PHONE", "COMPANY_PHONE_SECONDARY", "COMPANY_ADDRESS", "TAX_NUMBER", "COMMERCIAL_REGISTER", "COMPANY_LOGO_URL", "INVOICE_FOOTER"] },
    },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    name: map.get("COMPANY_NAME") ?? "BimmerERP",
    commercialName: map.get("COMMERCIAL_NAME") ?? "",
    phone: map.get("COMPANY_PHONE") ?? "",
    phonePrimary: map.get("COMPANY_PHONE") ?? "",
    phoneSecondary: map.get("COMPANY_PHONE_SECONDARY") ?? "",
    address: map.get("COMPANY_ADDRESS") ?? "",
    taxNumber: map.get("TAX_NUMBER") ?? "",
    commercialRegister: map.get("COMMERCIAL_REGISTER") ?? "",
    logoUrl: map.get("COMPANY_LOGO_URL") ?? "",
    invoiceFooter: map.get("INVOICE_FOOTER") ?? "",
  };
}

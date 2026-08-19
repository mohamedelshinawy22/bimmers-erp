import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { getCompanyProfile } from "@/server/services/settings.service";
import BarcodeSettingsClient from "./barcode-settings-client";

export const metadata = { title: "إعدادات طباعة الباركود الحرارية" };
export const dynamic = "force-dynamic";

export default async function ThermalBarcodeSettingsPage() {
  try { await requirePermission("barcode.manage"); }
  catch { redirect("/settings"); }
  const company = await getCompanyProfile();
  return <BarcodeSettingsClient company={{ name: company.name, logoUrl: company.logoUrl }} />;
}

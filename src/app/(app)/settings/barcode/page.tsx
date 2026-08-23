import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { getCompanyProfile } from "@/server/services/settings.service";
import BarcodeSettingsClient from "./barcode-settings-client";

export const metadata = { title: "إعدادات طباعة الباركود الحرارية" };
export const dynamic = "force-dynamic";

export default async function ThermalBarcodeSettingsPage() {
  try { await requirePermission("barcode.manage"); }
  catch { redirect("/settings"); }
  const tenant = await getTenantDbFromSession();
  let company: Awaited<ReturnType<typeof getCompanyProfile>>;
  try {
    company = await tenant.run(async () => getCompanyProfile());
  } catch (error) {
    console.error("Unable to load tenant-scoped barcode settings", { tenantId: tenant.user.tenantId, error });
    company = { name: "Bimmers ERP", commercialName: "", phone: "", phonePrimary: "", phoneSecondary: "", address: "", taxNumber: "", commercialRegister: "", logoUrl: "", invoiceFooter: "" };
  }
  return <BarcodeSettingsClient company={{ name: company.name, logoUrl: company.logoUrl }} />;
}

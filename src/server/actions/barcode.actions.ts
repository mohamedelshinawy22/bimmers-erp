"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { writeAudit } from "@/lib/audit";
import { barcodeConfigSchema, type BarcodeConfigInput } from "@/lib/validations/barcode";
import { DEFAULT_THERMAL_BARCODE_PROFILE, THERMAL_BARCODE_PROFILE_KEY, thermalBarcodeProfileSchema } from "@/lib/thermal-barcode-profile";

export type PrintableBarcodePart = {
  id: string;
  nameAr: string;
  oemNumber: string;
  barcode: string | null;
  brandName: string | null;
  chassisCodes: string[];
  sellPriceRetail: number;
};

export async function getPrintableBarcodePartsAction(query = ""): Promise<ActionResult<PrintableBarcodePart[]>> {
  try {
    await requirePermission("part.read");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
      const term = query.trim();
      const parts = await tenant.prisma.partItem.findMany({
        where: {
          isActive: true,
          isDeleted: false,
          ...(term ? { OR: [{ nameAr: { contains: term, mode: "insensitive" } }, { oemNumber: { contains: term, mode: "insensitive" } }, { barcode: { contains: term, mode: "insensitive" } }] } : {}),
        },
        take: 100,
        orderBy: [{ nameAr: "asc" }, { oemNumber: "asc" }],
        select: {
          id: true,
          nameAr: true,
          oemNumber: true,
          barcode: true,
          sellPriceRetail: true,
          brand: { select: { name: true } },
          compatibleChassis: { select: { chassis: { select: { code: true } } } },
        },
      });
      return ok(parts.map((part) => ({
        id: part.id,
        nameAr: part.nameAr,
        oemNumber: part.oemNumber,
        barcode: part.barcode,
        brandName: part.brand.name,
        chassisCodes: part.compatibleChassis.map((item) => item.chassis.code),
        sellPriceRetail: Number(part.sellPriceRetail),
      })));
    });
  } catch (error) {
    return toActionError(error, "getPrintableBarcodePartsAction");
  }
}

export async function getBarcodeSettingsAction() {
  try {
    await requirePermission("barcode.manage");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => ok(await tenant.prisma.barcodeConfig.findUnique({ where: { scopeKey: "COMPANY" } })));
  } catch (error) { return toActionError(error, "getBarcodeSettingsAction"); }
}

export async function getThermalBarcodeProfileAction() {
  try {
    await requirePermission("part.read");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
      const setting = await tenant.prisma.systemSetting.findUnique({ where: { key: THERMAL_BARCODE_PROFILE_KEY } });
      if (!setting) return ok(DEFAULT_THERMAL_BARCODE_PROFILE);
      try { return ok(thermalBarcodeProfileSchema.parse(JSON.parse(setting.value))); }
      catch { return ok(DEFAULT_THERMAL_BARCODE_PROFILE); }
    });
  } catch (error) { return toActionError(error, "getThermalBarcodeProfileAction"); }
}

export async function saveThermalBarcodeProfileAction(raw: unknown): Promise<ActionResult<{ saved: true }>> {
  try {
    const user = await requirePermission("barcode.manage");
    const tenant = await getTenantDbFromSession();
    const profile = thermalBarcodeProfileSchema.parse(raw);
    return tenant.run(async () => {
    await tenant.prisma.$transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key: THERMAL_BARCODE_PROFILE_KEY } });
      const saved = await tx.systemSetting.upsert({ where: { key: THERMAL_BARCODE_PROFILE_KEY }, create: { key: THERMAL_BARCODE_PROFILE_KEY, value: JSON.stringify(profile), group: "BARCODE", label: "ملف الطابعة الحرارية" }, update: { value: JSON.stringify(profile), group: "BARCODE", label: "ملف الطابعة الحرارية" } });
      await writeAudit(tx, { tableName: "SystemSetting", recordId: saved.key, action: before ? "UPDATE" : "INSERT", oldData: before, newData: saved, performedBy: user.id });
    });
    revalidatePath("/settings/barcode");
    revalidatePath("/settings/barcode-designer");
    return ok({ saved: true });
    });
  } catch (error) { return toActionError(error, "saveThermalBarcodeProfileAction"); }
}

export async function saveBarcodeSettingsAction(raw: BarcodeConfigInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("barcode.manage");
    const tenant = await getTenantDbFromSession();
    const input = barcodeConfigSchema.parse(raw);
    return tenant.run(async () => {
    const config = await tenant.prisma.$transaction(async (tx) => {
      const before = await tx.barcodeConfig.findUnique({ where: { scopeKey: "COMPANY" } });
      const saved = await tx.barcodeConfig.upsert({ where: { scopeKey: "COMPANY" }, create: { scopeKey: "COMPANY", ...input }, update: input });
      await writeAudit(tx, { tableName: "BarcodeConfig", recordId: saved.id, action: before ? "UPDATE" : "INSERT", oldData: before, newData: saved, performedBy: user.id });
      return saved;
    });
    revalidatePath("/settings/barcode-designer");
    return ok({ id: config.id });
    });
  } catch (error) { return toActionError(error, "saveBarcodeSettingsAction"); }
}

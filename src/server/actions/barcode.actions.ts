"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { writeAudit } from "@/lib/audit";
import { barcodeConfigSchema, type BarcodeConfigInput } from "@/lib/validations/barcode";
import { DEFAULT_THERMAL_BARCODE_PROFILE, THERMAL_BARCODE_PROFILE_KEY, thermalBarcodeProfileSchema } from "@/lib/thermal-barcode-profile";

export async function getBarcodeSettingsAction() {
  try {
    await requirePermission("barcode.manage");
    const config = await prisma.barcodeConfig.findUnique({ where: { scopeKey: "COMPANY" } });
    return ok(config);
  } catch (error) { return toActionError(error, "getBarcodeSettingsAction"); }
}

export async function getThermalBarcodeProfileAction() {
  try {
    await requirePermission("part.read");
    const setting = await prisma.systemSetting.findUnique({ where: { key: THERMAL_BARCODE_PROFILE_KEY } });
    if (!setting) return ok(DEFAULT_THERMAL_BARCODE_PROFILE);
    try { return ok(thermalBarcodeProfileSchema.parse(JSON.parse(setting.value))); }
    catch { return ok(DEFAULT_THERMAL_BARCODE_PROFILE); }
  } catch (error) { return toActionError(error, "getThermalBarcodeProfileAction"); }
}

export async function saveThermalBarcodeProfileAction(raw: unknown): Promise<ActionResult<{ saved: true }>> {
  try {
    const user = await requirePermission("barcode.manage");
    const profile = thermalBarcodeProfileSchema.parse(raw);
    await prisma.$transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key: THERMAL_BARCODE_PROFILE_KEY } });
      const saved = await tx.systemSetting.upsert({ where: { key: THERMAL_BARCODE_PROFILE_KEY }, create: { key: THERMAL_BARCODE_PROFILE_KEY, value: JSON.stringify(profile), group: "BARCODE", label: "ملف الطابعة الحرارية" }, update: { value: JSON.stringify(profile), group: "BARCODE", label: "ملف الطابعة الحرارية" } });
      await writeAudit(tx, { tableName: "SystemSetting", recordId: saved.key, action: before ? "UPDATE" : "INSERT", oldData: before, newData: saved, performedBy: user.id });
    });
    revalidatePath("/settings/barcode");
    revalidatePath("/settings/barcode-designer");
    return ok({ saved: true });
  } catch (error) { return toActionError(error, "saveThermalBarcodeProfileAction"); }
}

export async function saveBarcodeSettingsAction(raw: BarcodeConfigInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("barcode.manage");
    const input = barcodeConfigSchema.parse(raw);
    const config = await prisma.$transaction(async (tx) => {
      const before = await tx.barcodeConfig.findUnique({ where: { scopeKey: "COMPANY" } });
      const saved = await tx.barcodeConfig.upsert({ where: { scopeKey: "COMPANY" }, create: { scopeKey: "COMPANY", ...input }, update: input });
      await writeAudit(tx, { tableName: "BarcodeConfig", recordId: saved.id, action: before ? "UPDATE" : "INSERT", oldData: before, newData: saved, performedBy: user.id });
      return saved;
    });
    revalidatePath("/settings/barcode-designer");
    return ok({ id: config.id });
  } catch (error) { return toActionError(error, "saveBarcodeSettingsAction"); }
}

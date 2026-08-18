"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { writeAudit } from "@/lib/audit";
import { barcodeConfigSchema, type BarcodeConfigInput } from "@/lib/validations/barcode";

export async function getBarcodeSettingsAction() {
  try {
    await requirePermission("barcode.manage");
    const config = await prisma.barcodeConfig.findUnique({ where: { scopeKey: "COMPANY" } });
    return ok(config);
  } catch (error) { return toActionError(error, "getBarcodeSettingsAction"); }
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

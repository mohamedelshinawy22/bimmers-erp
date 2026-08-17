"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { updateSettingsSchema } from "@/lib/validations/accounts";
import {
  BOOLEAN_SETTING_KEYS as BOOLEAN_KEYS,
  NUMERIC_SETTING_KEYS as NUMERIC_KEYS,
} from "@/lib/settings-keys";



export async function updateSettingsAction(
  raw: { entries: Array<{ key: string; value: string }> },
): Promise<ActionResult<{ updated: number }>> {
  try {
    const user = await requirePermission("settings.write");
    const input = updateSettingsSchema.parse(raw);

    for (const entry of input.entries) {
      if (BOOLEAN_KEYS.has(entry.key) && !["true", "false"].includes(entry.value)) {
        throw new BusinessRuleError(`الإعداد "${entry.key}" يقبل true أو false فقط.`);
      }
      if (NUMERIC_KEYS.has(entry.key)) {
        const n = Number(entry.value);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          throw new BusinessRuleError(`الإعداد "${entry.key}" يجب أن يكون رقماً بين 0 و 100.`);
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.systemSetting.findMany({
        where: { key: { in: input.entries.map((e) => e.key) } },
        select: { key: true, value: true },
      });
      const existingMap = new Map(existing.map((e) => [e.key, e.value]));

      const missing = input.entries.filter((e) => !existingMap.has(e.key));
      if (missing.length) {
        throw new BusinessRuleError(`إعدادات غير معروفة: ${missing.map((m) => m.key).join(", ")}`);
      }

      let count = 0;
      for (const entry of input.entries) {
        if (existingMap.get(entry.key) === entry.value) continue;
        await tx.systemSetting.update({ where: { key: entry.key }, data: { value: entry.value } });
        count++;
      }

      if (count > 0) {
        await writeAudit(tx, {
          tableName: "SystemSetting",
          recordId: "BULK",
          action: "UPDATE",
          oldData: existing,
          newData: input.entries,
          performedBy: user.id,
        });
      }
      return count;
    });

    revalidatePath("/settings");
    revalidatePath("/");
    return ok({ updated });
  } catch (error) {
    return toActionError(error, "updateSettingsAction");
  }
}

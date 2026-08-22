"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBackupSnapshot, restoreFullBackupSnapshot, restoreLimits } from "@/server/services/system-backup.service";

const MAX_JSON_CHARS = 20 * 1024 * 1024;
const inspectSchema = z.object({ backupJson: z.string().min(2, "ملف النسخة الاحتياطية فارغ.").max(MAX_JSON_CHARS, "حجم النسخة الاحتياطية يتجاوز الحد الآمن للاستعادة عبر الويب (20MB).") });
const restoreSchema = inspectSchema.extend({ confirmationPhrase: z.string(), adminPassword: z.string().min(1, "كلمة مرور مدير النظام مطلوبة.").max(256) });

export async function inspectFullSystemBackupAction(raw: unknown): Promise<ActionResult<{ createdAt: string; users: number; parts: number; accounts: number; treasuries: number; invoices: number; transactions: number; stockMovements: number; maxBytes: number; confirmationPhrase: string }>> {
  try {
    await requirePermission("system.backup");
    const input = inspectSchema.parse(raw);
    const snapshot = parseBackupSnapshot(JSON.parse(input.backupJson));
    const limits = restoreLimits();
    return ok({ createdAt: snapshot.metadata.createdAt, users: snapshot.counts.users ?? 0, parts: snapshot.counts.parts ?? 0, accounts: snapshot.counts.accounts ?? 0, treasuries: snapshot.counts.treasuries ?? 0, invoices: snapshot.counts.invoices ?? 0, transactions: snapshot.counts.treasuryTransactions ?? 0, stockMovements: snapshot.counts.stockMovements ?? 0, maxBytes: limits.maxBytes, confirmationPhrase: limits.confirmationPhrase });
  } catch (error) {
    return toActionError(error, "inspectFullSystemBackupAction");
  }
}

export async function restoreFullSystemBackupAction(raw: unknown): Promise<ActionResult<{ createdAt: string; users: number; parts: number; accounts: number; treasuries: number; invoices: number; transactions: number; stockMovements: number }>> {
  try {
    const actor = await requirePermission("system.maintenance");
    const input = restoreSchema.parse(raw);
    const snapshot = JSON.parse(input.backupJson);
    const result = await restoreFullBackupSnapshot({ actor, adminPassword: input.adminPassword, confirmationPhrase: input.confirmationPhrase, snapshot, serializedBytes: Buffer.byteLength(input.backupJson, "utf8") });
    for (const path of ["/", "/accounts", "/inventory", "/invoices", "/pos", "/treasury", "/vouchers", "/reports/daily-movement", "/settings", "/audit"]) revalidatePath(path);
    revalidatePath("/", "layout");
    return ok(result);
  } catch (error) {
    return toActionError(error, "restoreFullSystemBackupAction");
  }
}

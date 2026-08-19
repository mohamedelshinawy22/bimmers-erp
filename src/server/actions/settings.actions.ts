"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { getCompanyProfile, type CompanyProfile } from "@/server/services/settings.service";
import { companyProfileSettingsSchema, updateSettingsSchema, type CompanyProfileSettingsInput } from "@/lib/validations/accounts";
import {
  BOOLEAN_SETTING_KEYS as BOOLEAN_KEYS,
  NUMERIC_SETTING_KEYS as NUMERIC_KEYS,
} from "@/lib/settings-keys";



export async function getCompanyProfileForPrintAction(): Promise<ActionResult<CompanyProfile>> {
  try {
    await requirePermission("reports.dailyMovement");
    return ok(await getCompanyProfile());
  } catch (error) {
    return toActionError(error, "getCompanyProfileForPrintAction");
  }
}

export async function updateCompanySettingsAction(raw: CompanyProfileSettingsInput): Promise<ActionResult<{ updated: number }>> {
  try {
    const user = await requirePermission("settings.write");
    const input = companyProfileSettingsSchema.parse(raw);
    const entries = [
      { key: "COMPANY_NAME", value: input.companyName, group: "GENERAL", label: "اسم الشركة / المنشأة" },
      { key: "COMMERCIAL_NAME", value: input.commercialName, group: "GENERAL", label: "الاسم التجاري / النشاط" },
      { key: "COMPANY_ADDRESS", value: input.address, group: "GENERAL", label: "عنوان المنشأة" },
      { key: "COMPANY_PHONE", value: input.phonePrimary, group: "GENERAL", label: "الهاتف الرئيسي" },
      { key: "COMPANY_PHONE_SECONDARY", value: input.phoneSecondary, group: "GENERAL", label: "الهاتف الثانوي" },
      { key: "TAX_NUMBER", value: input.taxNumber, group: "TAX", label: "رقم التسجيل الضريبي" },
      { key: "COMMERCIAL_REGISTER", value: input.commercialRegister, group: "GENERAL", label: "السجل التجاري" },
      { key: "COMPANY_LOGO_URL", value: input.logoUrl, group: "PRINTING", label: "رابط الشعار" },
      { key: "INVOICE_FOOTER", value: input.footerNote, group: "PRINTING", label: "تذييل الفاتورة وشروط الضمان" },
    ];
    const updated = await prisma.$transaction(async (tx) => {
      const before = await tx.systemSetting.findMany({ where: { key: { in: entries.map((entry) => entry.key) } } });
      let count = 0;
      for (const entry of entries) {
        const old = before.find((item) => item.key === entry.key);
        if (old?.value === entry.value) continue;
        await tx.systemSetting.upsert({ where: { key: entry.key }, create: entry, update: { value: entry.value, group: entry.group, label: entry.label } });
        count++;
      }
      if (count) await writeAudit(tx, { tableName: "SystemSetting", recordId: "COMPANY_PROFILE", action: "UPDATE", oldData: before, newData: entries, performedBy: user.id });
      return count;
    });
    for (const path of ["/settings", "/", "/dashboard", "/invoices", "/pos", "/accounts", "/inventory"]) revalidatePath(path);
    revalidatePath("/", "layout");
    return ok({ updated });
  } catch (error) {
    return toActionError(error, "updateCompanySettingsAction");
  }
}

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

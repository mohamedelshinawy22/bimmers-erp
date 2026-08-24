"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { serializeData } from "@/lib/serialize";
import { getCompanyProfile, type CompanyProfile } from "@/server/services/settings.service";
import { companyProfileSettingsSchema, updateSettingsSchema, type CompanyProfileSettingsInput } from "@/lib/validations/accounts";
import {
  BOOLEAN_SETTING_KEYS as BOOLEAN_KEYS,
  NUMERIC_SETTING_KEYS as NUMERIC_KEYS,
} from "@/lib/settings-keys";

export async function getCompanyProfileForPrintAction(): Promise<ActionResult<CompanyProfile>> {
  try {
    await requirePermission("reports.dailyMovement");
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => ok(await getCompanyProfile(tenant.prisma)));
  } catch (error) {
    return toActionError(error, "getCompanyProfileForPrintAction");
  }
}

export async function updateCompanySettingsAction(raw: CompanyProfileSettingsInput): Promise<ActionResult<{ updated: number; settings: unknown[] }>> {
  try {
    const user = await requirePermission("settings.write");
    const tenant = await getTenantDbFromSession();
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
    const result = await tenant.run(() => tenant.prisma.$transaction(async (tx) => {
      const before = await tx.systemSetting.findMany({ where: { key: { in: entries.map((entry) => entry.key) } } });
      let updated = 0;
      const settings = [];
      for (const entry of entries) {
        const old = before.find((item) => item.key === entry.key);
        if (old?.value !== entry.value) updated++;
        settings.push(await tx.systemSetting.upsert({
          where: { key: entry.key },
          create: entry,
          update: { value: entry.value, group: entry.group, label: entry.label },
        }));
      }
      return { updated, before, settings };
    }));

    if (result.updated) {
      try {
        await tenant.run(() => writeAudit(tenant.prisma, {
          tableName: "SystemSetting",
          recordId: "COMPANY_PROFILE",
          action: "UPDATE",
          oldData: result.before,
          newData: result.settings,
          performedBy: user.id,
        }));
      } catch (auditError) {
        console.warn("[updateCompanySettingsAction] audit write failed after settings save:", auditError);
      }
    }

    for (const path of ["/settings", "/", "/dashboard", "/invoices", "/pos", "/accounts", "/inventory"]) revalidatePath(path);
    revalidatePath("/", "layout");
    return ok({ updated: result.updated, settings: serializeData(result.settings) });
  } catch (error) {
    return toActionError(error, "updateCompanySettingsAction");
  }
}

export async function updateSettingsAction(
  raw: { entries: Array<{ key: string; value: string }> },
): Promise<ActionResult<{ updated: number }>> {
  try {
    const user = await requirePermission("settings.write");
    const tenant = await getTenantDbFromSession();
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

    const result = await tenant.run(() => tenant.prisma.$transaction(async (tx) => {
      const existing = await tx.systemSetting.findMany({
        where: { key: { in: input.entries.map((entry) => entry.key) } },
        select: { key: true, value: true },
      });
      const existingMap = new Map(existing.map((entry) => [entry.key, entry.value]));
      const missing = input.entries.filter((entry) => !existingMap.has(entry.key));
      if (missing.length) throw new BusinessRuleError(`إعدادات غير معروفة: ${missing.map((entry) => entry.key).join(", ")}`);

      let updated = 0;
      for (const entry of input.entries) {
        if (existingMap.get(entry.key) === entry.value) continue;
        await tx.systemSetting.update({ where: { key: entry.key }, data: { value: entry.value } });
        updated++;
      }
      return { updated, existing };
    }));

    if (result.updated) {
      try {
        await tenant.run(() => writeAudit(tenant.prisma, {
          tableName: "SystemSetting",
          recordId: "BULK",
          action: "UPDATE",
          oldData: result.existing,
          newData: input.entries,
          performedBy: user.id,
        }));
      } catch (auditError) {
        console.warn("[updateSettingsAction] audit write failed after settings save:", auditError);
      }
    }

    revalidatePath("/settings");
    revalidatePath("/");
    return ok({ updated: result.updated });
  } catch (error) {
    return toActionError(error, "updateSettingsAction");
  }
}

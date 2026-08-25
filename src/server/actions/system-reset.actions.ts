"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { bootstrapTenantDatabase } from "@/server/db/bootstrap-tenant";

const RESET_CONFIRMATION_PHRASE = "مسح شامل وتصفير النظام";
const resetSchema = z.object({
  confirmationPhrase: z.string().refine((value) => value === RESET_CONFIRMATION_PHRASE, "عبارة التأكيد غير مطابقة."),
  adminPassword: z.string().min(1, "كلمة مرور مدير النظام مطلوبة.").max(256),
});

export async function purgeAllSystemDataAction(raw: { confirmationPhrase: string; adminPassword: string }): Promise<ActionResult<{ invoices: number; vouchers: number; parts: number; accounts: number; treasuries: number }>> {
  try {
    const actor = await requirePermission("system.maintenance");
    if (actor.role !== "SUPER_ADMIN") throw new BusinessRuleError("صلاحية إعادة ضبط المصنع متاحة لمدير النظام فقط.");
    const tenant = await getTenantDbFromSession();
    const db = tenant.prisma;
    const input = resetSchema.parse(raw);
    const administrator = await tenant.run(() => db.user.findUnique({ where: { id: actor.id }, select: { id: true, passwordHash: true, isActive: true } }));
    if (!administrator || !administrator.isActive) throw new BusinessRuleError("تعذر التحقق من حساب مدير النظام الحالي.");

    const passwordMatches = await bcrypt.compare(input.adminPassword, administrator.passwordHash);
    if (!passwordMatches) {
      const ipAddress = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      await tenant.run(() => db.systemAuditTrail.create({ data: { tableName: "System", recordId: "FACTORY_RESET", action: "SYSTEM_FACTORY_RESET_DENIED", newData: { reason: "BAD_PASSWORD" }, performedBy: actor.id, ipAddress } }));
      return fail("كلمة مرور مدير النظام غير صحيحة. تم إلغاء عملية المسح.");
    }

    const result = await tenant.run(async () => {
      const [invoices, vouchers, parts, accounts, treasuries] = await Promise.all([db.invoice.count(), db.treasuryTransaction.count(), db.partItem.count(), db.account.count(), db.treasury.count()]);
      const phase = async (name: string, work: () => Promise<unknown>) => {
        try { await work(); } catch (error) { console.error(`[factory-reset] ${name} failed`, error); throw new BusinessRuleError(`تعذر إتمام مرحلة «${name}» من إعادة الضبط. أعد المحاولة.`); }
      };

      // Each destructive query commits independently. This keeps the serverless
      // interactive transaction budget out of the reset path and makes retries idempotent.
      await phase("إلغاء صلاحيات النطاق", () => db.user.updateMany({ data: { allowedTreasuryIds: [], allowedWarehouseIds: [], transferToTreasuryId: null } }));
      await phase("الحركات المالية", async () => { await db.treasuryTransaction.deleteMany(); await db.treasuryTransfer.deleteMany(); await db.treasuryShift.deleteMany(); await db.accountBalanceAdjustment.deleteMany(); });
      await phase("مستندات البيع والشيكات", async () => { await db.invoiceItem.deleteMany(); await db.heldSaleItem.deleteMany(); await db.heldSale.deleteMany(); await db.invoice.deleteMany(); await db.installment.deleteMany(); await db.installmentPlan.deleteMany(); await db.accountCheck.deleteMany(); });
      await phase("المخزون والاستيراد", async () => { await db.stockMovement.deleteMany(); await db.importJob.deleteMany(); await db.partChassis.deleteMany(); await db.partEngine.deleteMany(); await db.partItem.deleteMany(); });
      await phase("بيانات العملاء والمخازن", async () => { await db.customerVehicle.deleteMany(); await db.warehouseBin.deleteMany(); await db.account.deleteMany(); await db.treasury.deleteMany(); });
      await phase("البيانات الأساسية", async () => { await db.category.updateMany({ data: { parentId: null } }); await db.category.deleteMany(); await db.brand.deleteMany(); await db.bmwChassis.deleteMany(); await db.bmwEngine.deleteMany(); await db.barcodeConfig.deleteMany(); await db.documentCounter.deleteMany(); await db.systemSetting.deleteMany(); });
      await phase("سجل التدقيق", () => db.systemAuditTrail.deleteMany());
      const baseline = await bootstrapTenantDatabase(db);
      await db.user.updateMany({ data: { allowedTreasuryIds: [baseline.mainTreasuryId, baseline.cashDrawerId] } });
      await db.systemAuditTrail.create({ data: { tableName: "System", recordId: "FACTORY_RESET", action: "SYSTEM_FACTORY_RESET", newData: { event: "SYSTEM_FACTORY_RESET", executedBy: actor.fullName, invoicesPurged: invoices, vouchersPurged: vouchers, partsPurged: parts, accountsPurged: accounts, treasuriesPurged: treasuries, mode: "PHASED_TENANT_WIPE" }, performedBy: actor.id } });
      return { invoices, vouchers, parts, accounts, treasuries };
    });

    for (const path of ["/", "/accounts", "/inventory", "/invoices", "/pos", "/treasury", "/vouchers", "/reports/daily-movement", "/settings"]) revalidatePath(path);
    revalidatePath("/", "layout");
    return ok(result);
  } catch (error) {
    return toActionError(error, "purgeAllSystemDataAction");
  }
}

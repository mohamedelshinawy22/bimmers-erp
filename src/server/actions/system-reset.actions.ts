"use server";

import bcrypt from "bcryptjs";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fail, ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";

const RESET_CONFIRMATION_PHRASE = "مسح شامل وتصفير النظام";
const resetSchema = z.object({
  confirmationPhrase: z.string().refine((value) => value === RESET_CONFIRMATION_PHRASE, "عبارة التأكيد غير مطابقة."),
  adminPassword: z.string().min(1, "كلمة مرور مدير النظام مطلوبة.").max(256),
});

const baselineSettings = [
  { key: "COMPANY_NAME", value: "بيمرز لقطع غيار BMW", group: "GENERAL", label: "اسم الشركة / المنشأة" },
  { key: "COMMERCIAL_NAME", value: "قطع غيار BMW", group: "GENERAL", label: "الاسم التجاري / النشاط" },
  { key: "COMPANY_PHONE", value: "", group: "GENERAL", label: "الهاتف الرئيسي" },
  { key: "COMPANY_PHONE_SECONDARY", value: "", group: "GENERAL", label: "الهاتف الثانوي" },
  { key: "COMPANY_ADDRESS", value: "", group: "GENERAL", label: "عنوان الشركة" },
  { key: "COMMERCIAL_REGISTER", value: "", group: "GENERAL", label: "السجل التجاري" },
  { key: "TAX_NUMBER", value: "", group: "TAX", label: "الرقم الضريبي" },
  { key: "TAX_RATE_PERCENT", value: "0", group: "TAX", label: "نسبة ضريبة القيمة المضافة %" },
  { key: "COMPANY_LOGO_URL", value: "", group: "PRINTING", label: "رابط الشعار" },
  { key: "INVOICE_FOOTER", value: "شكراً لتعاملكم معنا", group: "PRINTING", label: "تذييل الفاتورة وشروط الضمان" },
  { key: "ALLOW_NEGATIVE_STOCK", value: "false", group: "INVENTORY", label: "السماح بالبيع بالسالب" },
  { key: "ENFORCE_MIN_SELL_PRICE", value: "true", group: "PRICING", label: "إجبار حد السعر الأدنى" },
  { key: "ENFORCE_CREDIT_LIMIT", value: "true", group: "PRICING", label: "إجبار حد الائتمان" },
  { key: "MAX_INVOICE_DISCOUNT_PERCENT", value: "20", group: "PRICING", label: "أقصى نسبة خصم على الفاتورة %" },
  { key: "PART_CATEGORIES", value: JSON.stringify(["الفرامل", "التعليق والمقصات", "المحرك", "الكهرباء والإشعال", "التبريد والرادياتير", "ناقل الحركة", "العفشة والمساعدين", "الفلاتر والزيوت", "الهيكل والصدامات", "التكييف"]), group: "INVENTORY", label: "تصنيفات قطع الغيار" },
];

export async function purgeAllSystemDataAction(raw: { confirmationPhrase: string; adminPassword: string }): Promise<ActionResult<{ invoices: number; vouchers: number; parts: number; accounts: number; treasuries: number }>> {
  try {
    const actor = await requirePermission("system.maintenance");
    if (actor.role !== "SUPER_ADMIN") throw new BusinessRuleError("صلاحية إعادة ضبط المصنع متاحة لمدير النظام فقط.");
    const input = resetSchema.parse(raw);
    const administrator = await prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, passwordHash: true, isActive: true } });
    if (!administrator || !administrator.isActive) throw new BusinessRuleError("تعذر التحقق من حساب مدير النظام الحالي.");

    const passwordMatches = await bcrypt.compare(input.adminPassword, administrator.passwordHash);
    if (!passwordMatches) {
      const ipAddress = headers().get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      await prisma.systemAuditTrail.create({ data: { tableName: "System", recordId: "FACTORY_RESET", action: "SYSTEM_FACTORY_RESET_DENIED", newData: { reason: "BAD_PASSWORD" }, performedBy: actor.id, ipAddress } });
      return fail("كلمة مرور مدير النظام غير صحيحة. تم إلغاء عملية المسح.");
    }

    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      const [invoices, vouchers, parts, accounts, treasuries] = await Promise.all([
        tx.invoice.count(), tx.treasuryTransaction.count(), tx.partItem.count(), tx.account.count(), tx.treasury.count(),
      ]);

      // Preserve users and their permission profiles. Any treasury references become invalid after a clean reset and are restored after the baseline treasuries are recreated.
      await tx.user.updateMany({ data: { allowedTreasuryIds: [], allowedWarehouseIds: [], transferToTreasuryId: null } });

      // Remove dependent financial and operational records before their parent masters. This order respects every restrict relation in the live Prisma schema.
      await tx.treasuryTransaction.deleteMany();
      await tx.treasuryTransfer.deleteMany();
      await tx.stockMovement.deleteMany();
      await tx.invoiceItem.deleteMany();
      await tx.heldSaleItem.deleteMany();
      await tx.heldSale.deleteMany();
      await tx.invoice.deleteMany();
      await tx.treasuryShift.deleteMany();
      await tx.installment.deleteMany();
      await tx.installmentPlan.deleteMany();
      await tx.accountCheck.deleteMany();
      await tx.accountBalanceAdjustment.deleteMany();
      await tx.customerVehicle.deleteMany();
      await tx.importJob.deleteMany();
      await tx.partChassis.deleteMany();
      await tx.partEngine.deleteMany();
      await tx.partItem.deleteMany();
      await tx.warehouseBin.deleteMany();
      await tx.account.deleteMany();
      await tx.treasury.deleteMany();
      await tx.category.updateMany({ data: { parentId: null } });
      await tx.category.deleteMany();
      await tx.brand.deleteMany();
      await tx.bmwChassis.deleteMany();
      await tx.bmwEngine.deleteMany();
      await tx.barcodeConfig.deleteMany();
      await tx.documentCounter.deleteMany();
      await tx.systemSetting.deleteMany();

      // The old audit history is intentionally cleared only after the authenticated reset succeeds. A fresh immutable reset event is added below as the new system baseline.
      await tx.systemAuditTrail.deleteMany();

      const [mainTreasury, cashDrawer] = await Promise.all([
        tx.treasury.create({ data: { name: "الخزينة الرئيسية", type: "CASH_DRAWER", currentBalance: 0, isActive: true, isDefault: true, notes: "خزينة أساسية منشأة بعد إعادة ضبط المصنع" } }),
        tx.treasury.create({ data: { name: "درج النقدية", type: "CASH_DRAWER", currentBalance: 0, isActive: true, isDefault: false, notes: "درج الكاشير الافتراضي بعد إعادة ضبط المصنع" } }),
      ]);
      await tx.warehouseBin.create({ data: { warehouseName: "المخزن الرئيسي", aisle: "A0", rack: "00", shelf: "A", boxBin: "00", fullCode: "MAIN-A0-00-A-00" } });
      await tx.account.create({ data: { accountNumber: "ACC-0001", name: "عميل نقدي افتراضي (Walk-in)", type: "CUSTOMER", defaultPriceTier: "RETAIL", currentBalance: 0, creditLimit: 0, isActive: true, status: "ACTIVE", category: "WALK_IN_CASH" } });
      await tx.barcodeConfig.create({ data: { scopeKey: "COMPANY" } });
      await tx.systemSetting.createMany({ data: baselineSettings });
      await tx.user.updateMany({ data: { allowedTreasuryIds: [mainTreasury.id, cashDrawer.id] } });
      await tx.systemAuditTrail.create({ data: { tableName: "System", recordId: "FACTORY_RESET", action: "SYSTEM_FACTORY_RESET", newData: { event: "SYSTEM_FACTORY_RESET", executedBy: actor.fullName, invoicesPurged: invoices, vouchersPurged: vouchers, partsPurged: parts, accountsPurged: accounts, treasuriesPurged: treasuries, baseline: { warehouse: "المخزن الرئيسي", treasuries: [mainTreasury.name, cashDrawer.name], cashCustomer: "ACC-0001" } }, performedBy: actor.id } });
      return { invoices, vouchers, parts, accounts, treasuries };
    }, TX_OPTIONS));

    for (const path of ["/", "/accounts", "/inventory", "/invoices", "/pos", "/treasury", "/vouchers", "/reports/daily-movement", "/settings"]) revalidatePath(path);
    revalidatePath("/", "layout");
    return ok(result);
  } catch (error) {
    return toActionError(error, "purgeAllSystemDataAction");
  }
}

"use server";

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { requirePermission, requireUser } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { BusinessRuleError } from "@/lib/errors";
import { formatMoney, money } from "@/lib/utils";
import {
  createAccountSchema,
  createVehicleSchema,
  quickPosAccountSchema,
  updateAccountSchema,
  type CreateAccountInput,
  type CreateVehicleInput,
  type QuickPosAccountInput,
  type UpdateAccountInput,
} from "@/lib/validations/accounts";
import { nextAccountNumber } from "@/server/services/numbering.service";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";

const ACCOUNT_PREFIX: Record<CreateAccountInput["type"], string> = {
  CUSTOMER: "ACC",
  WORKSHOP_BMW: "WRK",
  SUPPLIER: "SUP",
  EXPENSE: "EXP",
  EMPLOYEE: "EMP",
  ADVANCE: "ADV",
  PARTNER: "PRT",
  OTHER: "OTH",
};

export async function createAccountAction(
  raw: CreateAccountInput,
): Promise<ActionResult<{ id: string; accountNumber: string; name: string; type: CreateAccountInput["type"]; phone: string | null; creditLimit: number; currentBalance: number; defaultPriceTier: string; status: string }>> {
  try {
    const user = await requirePermission("account.write");
    const input = createAccountSchema.parse(raw);

    const account = await prisma.$transaction(
      async (tx) => {
        const created = await tx.account.create({
          data: {
            accountNumber: await nextAccountNumber(tx, ACCOUNT_PREFIX[input.type]),
            name: input.name,
            type: input.type,
            phone: input.phone || null,
            email: input.email || null,
            address: input.address || null,
            taxNumber: input.taxNumber || null,
            creditLimit: money(input.creditLimit),
            currentBalance: input.type === "EXPENSE" ? money(0) : money(input.openingBalance),
            defaultPriceTier: input.defaultPriceTier,
            category: input.category || null,
            status: input.status,
            isActive: input.status !== "INACTIVE",
          },
        });
        await writeAudit(tx, {
          tableName: "Account",
          recordId: created.id,
          action: "INSERT",
          newData: created,
          performedBy: user.id,
        });
        return created;
      },
      TX_OPTIONS,
    );

    revalidatePath("/accounts");
    revalidatePath("/pos");
    return ok({
      id: account.id,
      accountNumber: account.accountNumber,
      name: account.name,
      type: account.type,
      phone: account.phone,
      creditLimit: Number(account.creditLimit),
      currentBalance: Number(account.currentBalance),
      defaultPriceTier: account.defaultPriceTier,
      status: account.status,
    });
  } catch (error) {
    return toActionError(error, "createAccountAction");
  }
}

export async function updateAccountAction(raw: UpdateAccountInput): Promise<ActionResult<{ id: string; balanceChanged: boolean }>> {
  try {
    const user = await requirePermission("account.write");
    const input = updateAccountSchema.parse(raw);
    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      const before = await tx.account.findUnique({ where: { id: input.id } });
      if (!before) throw new BusinessRuleError("الحساب غير موجود.");

      const adjustmentRequested = input.balanceAmount !== undefined || input.balanceNature !== undefined;
      if (adjustmentRequested && user.role !== "SUPER_ADMIN" && user.role !== "MANAGER") {
        throw new BusinessRuleError("تعديل الرصيد الدفتري يقتصر على مدير النظام أو المدير المالي.");
      }
      if (adjustmentRequested && (input.balanceAmount === undefined || input.balanceNature === undefined)) {
        throw new BusinessRuleError("حدّد مبلغ التسوية وطبيعة الرصيد معاً.");
      }
      const requestedAmount = money(input.balanceAmount ?? Math.abs(Number(before.currentBalance)));
      const targetBalance = !adjustmentRequested
        ? before.currentBalance
        : input.balanceNature === "DEBIT"
          ? requestedAmount.negated()
          : input.balanceNature === "CREDIT"
            ? requestedAmount
            : money(0);
      const delta = money(targetBalance.sub(before.currentBalance));
      const balanceChanged = !delta.eq(0);
      const adjustmentReason = input.adjustmentReason?.trim() || "تسوية رصيد دفتري مباشر";
      if (input.type === "EXPENSE" && !targetBalance.eq(0)) {
        throw new BusinessRuleError("حسابات المصروفات التشغيلية تبقى متزنة ولا تقبل رصيداً مديناً أو دائناً.");
      }
      if (balanceChanged && adjustmentReason.length < 5) {
        throw new BusinessRuleError("سبب تعديل الرصيد مطلوب ويجب أن يتكون من ٥ أحرف على الأقل للتدقيق المالي.");
      }

      // Credit limits gate new credit sales in POS/invoice flows; they never block an administrator from correcting an existing account profile or audited ledger balance.
      const newLimit = money(input.creditLimit);
      if (!input.isActive && !targetBalance.eq(0)) throw new BusinessRuleError("لا يمكن إيقاف حساب له رصيد مفتوح. قم بتسوية الرصيد أولاً.");

      const updated = await tx.account.update({
        where: { id: input.id },
        data: {
          name: input.name, type: input.type, phone: input.phone || null, email: input.email || null, address: input.address || null,
          taxNumber: input.taxNumber || null, creditLimit: newLimit, defaultPriceTier: input.defaultPriceTier, category: input.category || null,
          status: input.status, isActive: input.isActive && input.status !== "INACTIVE", currentBalance: targetBalance,
        },
      });
      if (balanceChanged) {
        const adjustment = await tx.accountBalanceAdjustment.create({
          data: { accountId: before.id, previousBalance: before.currentBalance, targetBalance, delta, targetNature: input.balanceNature!, reason: adjustmentReason, createdByUser: user.id, createdByName: user.fullName },
        });
        await writeAudit(tx, { tableName: "AccountBalanceAdjustment", recordId: adjustment.id, action: "INSERT", newData: { event: "ACCOUNT_BALANCE_MANUALLY_ADJUSTED", accountId: before.id, accountName: before.name, previousBalance: before.currentBalance, targetBalance, delta, targetNature: input.balanceNature, reason: adjustmentReason, adjustedBy: user.fullName }, performedBy: user.id });
      }
      await writeAudit(tx, { tableName: "Account", recordId: input.id, action: "UPDATE", oldData: before, newData: { ...updated, event: balanceChanged ? "ACCOUNT_UPDATED_WITH_BALANCE_RECONCILIATION" : "ACCOUNT_UPDATED", balanceAdjustment: balanceChanged ? { previousBalance: before.currentBalance, targetBalance, delta, nature: input.balanceNature, reason: adjustmentReason } : undefined }, performedBy: user.id });
      return { id: updated.id, balanceChanged };
    }, TX_OPTIONS));

    for (const path of ["/accounts", "/pos", "/invoices", "/treasury", "/vouchers", "/reports/daily-movement"]) revalidatePath(path);
    return ok(result);
  } catch (error) {
    return toActionError(error, "updateAccountAction");
  }
}

export async function createQuickPosAccountAction(
  raw: QuickPosAccountInput,
): Promise<ActionResult<{ id: string; accountNumber: string; name: string; type: CreateAccountInput["type"]; phone: string | null; creditLimit: number; currentBalance: number; defaultPriceTier: string; status: string }>> {
  try {
    await requirePermission("account.quickCreate");
    const input = quickPosAccountSchema.parse(raw);
    return createAccountAction({
      name: input.name,
      type: input.type,
      phone: input.phone ?? "",
      defaultPriceTier: input.defaultPriceTier,
      email: "",
      address: input.address ?? "",
      taxNumber: "",
      category: "",
      creditLimit: 0,
      openingBalance: input.openingBalance,
      status: "ACTIVE",
    });
  } catch (error) {
    return toActionError(error, "createQuickPosAccountAction");
  }
}

export async function resetExpenseAccountBalancesAction(): Promise<ActionResult<{ reset: number; totalCleared: number }>> {
  try {
    const user = await requireUser();
    if (user.role !== "SUPER_ADMIN") throw new BusinessRuleError("تصفير الأرصدة التاريخية للمصروفات يقتصر على مدير النظام.");
    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      const expenses = await tx.account.findMany({ where: { type: "EXPENSE", currentBalance: { not: 0 } }, orderBy: { id: "asc" } });
      let totalCleared = money(0);
      for (const expense of expenses) {
        const previousBalance = money(expense.currentBalance);
        totalCleared = money(totalCleared.add(previousBalance.abs()));
        const updated = await tx.account.update({ where: { id: expense.id }, data: { currentBalance: money(0) } });
        const adjustment = await tx.accountBalanceAdjustment.create({ data: { accountId: expense.id, previousBalance, targetBalance: money(0), delta: money(0).sub(previousBalance), targetNature: "ZERO", reason: "تصحيح تاريخي: حساب مصروف تشغيلي لا يدخل ضمن المدينيات أو المستحقات.", createdByUser: user.id, createdByName: user.fullName } });
        await writeAudit(tx, { tableName: "Account", recordId: expense.id, action: "UPDATE", oldData: expense, newData: { ...updated, event: "EXPENSE_BALANCE_RESET", adjustmentId: adjustment.id, previousBalance, targetBalance: 0 }, performedBy: user.id });
      }
      return { reset: expenses.length, totalCleared: Number(totalCleared) };
    }, TX_OPTIONS));
    for (const path of ["/accounts", "/vouchers", "/treasury", "/reports/daily-movement", "/"]) revalidatePath(path);
    return ok(result);
  } catch (error) {
    return toActionError(error, "resetExpenseAccountBalancesAction");
  }
}

export async function createVehicleAction(
  raw: CreateVehicleInput,
): Promise<ActionResult<{ id: string; vin: string }>> {
  try {
    const user = await requirePermission("account.write");
    const input = createVehicleSchema.parse(raw);

    const vehicle = await prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({
        where: { id: input.accountId },
        select: { id: true },
      });
      if (!account) throw new BusinessRuleError("الحساب غير موجود.");

      const duplicate = await tx.customerVehicle.findFirst({
        where: { accountId: input.accountId, vin: input.vin },
        select: { id: true },
      });
      if (duplicate) throw new BusinessRuleError("رقم الشاسيه (VIN) مسجّل بالفعل لهذا العميل.");

      const created = await tx.customerVehicle.create({
        data: {
          accountId: input.accountId,
          vin: input.vin,
          chassisId: input.chassisId,
          engineId: input.engineId,
          modelYear: input.modelYear,
          plateNumber: input.plateNumber || null,
          notes: input.notes || null,
        },
      });
      await writeAudit(tx, {
        tableName: "CustomerVehicle",
        recordId: created.id,
        action: "INSERT",
        newData: created,
        performedBy: user.id,
      });
      return created;
    });

    revalidatePath("/accounts");
    revalidatePath("/pos");
    return ok({ id: vehicle.id, vin: vehicle.vin });
  } catch (error) {
    return toActionError(error, "createVehicleAction");
  }
}


const accountIdSchema = z.object({ accountId: z.string().uuid() });
const archiveAccountSchema = accountIdSchema.extend({ reason: z.string().trim().max(500).optional().or(z.literal("")) });
const restoreAccountSchema = accountIdSchema.extend({ reason: z.string().trim().max(500).optional().or(z.literal("")) });
const forceDeleteAccountSchema = accountIdSchema.extend({ reason: z.string().trim().min(5, "اكتب سبباً لا يقل عن ٥ أحرف للحذف الإجباري.").max(500) });

export async function getAccountDeletionImpactAction(raw: { accountId: string }): Promise<ActionResult<{ accountName: string; accountNumber: string; currentBalance: number; isActive: boolean; status: string; impact: { invoices: number; activeInvoices: number; voidedInvoices: number; transactions: number; activeTransactions: number; voidedTransactions: number; vehicles: number; checks: number; activeChecks: number; installmentPlans: number; activeInstallmentPlans: number; heldSales: number; activeHeldSales: number }; canDirectDelete: boolean; canForceCleanup: boolean }>> {
  try {
    await requirePermission("account.write");
    const input = accountIdSchema.parse(raw);
    const [account, invoices, activeInvoices, transactions, activeTransactions, vehicles, checks, activeChecks, installmentPlans, activeInstallmentPlans, heldSales, activeHeldSales] = await Promise.all([
      prisma.account.findUnique({ where: { id: input.accountId }, select: { name: true, accountNumber: true, currentBalance: true, isActive: true, status: true } }),
      prisma.invoice.count({ where: { accountId: input.accountId } }),
      prisma.invoice.count({ where: { accountId: input.accountId, isVoided: false } }),
      prisma.treasuryTransaction.count({ where: { accountId: input.accountId } }),
      prisma.treasuryTransaction.count({ where: { accountId: input.accountId, status: { not: "VOIDED" } } }),
      prisma.customerVehicle.count({ where: { accountId: input.accountId } }),
      prisma.accountCheck.count({ where: { accountId: input.accountId } }),
      prisma.accountCheck.count({ where: { accountId: input.accountId, status: { notIn: ["CANCELLED", "VOIDED"] } } }),
      prisma.installmentPlan.count({ where: { accountId: input.accountId } }),
      prisma.installmentPlan.count({ where: { accountId: input.accountId, status: { notIn: ["CANCELLED", "VOIDED"] } } }),
      prisma.heldSale.count({ where: { accountId: input.accountId } }),
      prisma.heldSale.count({ where: { accountId: input.accountId, status: { not: "CANCELLED" } } }),
    ]);
    if (!account) throw new BusinessRuleError("الحساب غير موجود.");
    const currentBalance = Number(account.currentBalance);
    const voidedInvoices = invoices - activeInvoices;
    const voidedTransactions = transactions - activeTransactions;
    const canDirectDelete = currentBalance === 0 && invoices === 0 && transactions === 0 && vehicles === 0 && checks === 0 && installmentPlans === 0 && heldSales === 0;
    const canForceCleanup = currentBalance === 0 && activeInvoices === 0 && activeTransactions === 0 && activeChecks === 0 && activeInstallmentPlans === 0 && activeHeldSales === 0;
    return ok({ accountName: account.name, accountNumber: account.accountNumber, currentBalance, isActive: account.isActive, status: account.status, impact: { invoices, activeInvoices, voidedInvoices, transactions, activeTransactions, voidedTransactions, vehicles, checks, activeChecks, installmentPlans, activeInstallmentPlans, heldSales, activeHeldSales }, canDirectDelete, canForceCleanup });
  } catch (error) {
    return toActionError(error, "getAccountDeletionImpactAction");
  }
}

export async function archiveAccountAction(raw: { accountId: string; reason?: string }): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("account.write");
    const input = archiveAccountSchema.parse(raw);
    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({ where: { id: input.accountId } });
      if (!account) throw new BusinessRuleError("الحساب غير موجود.");
      if (!account.currentBalance.eq(0)) throw new BusinessRuleError("لا يمكن أرشفة حساب له رصيد مفتوح. سوِّ الرصيد أولاً للحفاظ على المتابعة المحاسبية.");
      const archived = await tx.account.update({ where: { id: account.id }, data: { isActive: false, status: "INACTIVE" } });
      await writeAudit(tx, { tableName: "Account", recordId: account.id, action: "UPDATE", oldData: account, newData: { event: "ACCOUNT_ARCHIVED", isActive: false, status: "INACTIVE", reason: input.reason || "أرشفة حساب يحتفظ بسجل تاريخي" }, performedBy: user.id });
      return { id: archived.id };
    }, TX_OPTIONS));
    revalidatePath("/accounts");
    revalidatePath("/pos");
    revalidatePath("/invoices");
    return ok(result);
  } catch (error) {
    return toActionError(error, "archiveAccountAction");
  }
}

export async function restoreAccountAction(raw: { accountId: string; reason?: string }): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const user = await requireUser();
    if (user.role !== "SUPER_ADMIN") throw new BusinessRuleError("صلاحية استعادة الحسابات المؤرشفة متاحة لمدير النظام فقط.");
    const input = restoreAccountSchema.parse(raw);
    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({ where: { id: input.accountId } });
      if (!account) throw new BusinessRuleError("الحساب غير موجود.");
      if (account.isActive && account.status === "ACTIVE") throw new BusinessRuleError("الحساب نشط بالفعل ولا يحتاج إلى استعادة.");
      const restored = await tx.account.update({ where: { id: account.id }, data: { isActive: true, status: "ACTIVE" } });
      await writeAudit(tx, { tableName: "Account", recordId: account.id, action: "UPDATE", oldData: account, newData: { event: "ACCOUNT_REACTIVATED", isActive: true, status: "ACTIVE", reason: input.reason || "استعادة الحساب بواسطة مدير النظام" }, performedBy: user.id });
      return { id: restored.id, name: restored.name };
    }, TX_OPTIONS));
    revalidatePath("/accounts");
    revalidatePath("/pos");
    revalidatePath("/invoices");
    return ok(result);
  } catch (error) {
    return toActionError(error, "restoreAccountAction");
  }
}

export async function deleteAccountCascadeAction(raw: { accountId: string; reason: string }): Promise<ActionResult<{ accountNumber: string; removed: { invoices: number; transactions: number; vehicles: number; checks: number; installmentPlans: number; heldSales: number } }>> {
  try {
    const user = await requireUser();
    if (user.role !== "SUPER_ADMIN") throw new BusinessRuleError("الحذف الإجباري متاح لمدير النظام فقط.");
    const input = forceDeleteAccountSchema.parse(raw);
    const result = await withTxRetry(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Account" WHERE "id" = ${input.accountId} FOR UPDATE`;
      const account = await tx.account.findUnique({ where: { id: input.accountId } });
      if (!account) throw new BusinessRuleError("الحساب غير موجود.");
      if (!account.currentBalance.eq(0)) throw new BusinessRuleError("لا يمكن الحذف الإجباري لحساب له رصيد. سوِّ الرصيد أولاً ثم أعد المحاولة.");

      const [invoices, transactions, vehicles, checks, installmentPlans, heldSales, activeInvoices, activeTransactions, activeChecks, activeInstallmentPlans, activeHeldSales] = await Promise.all([
        tx.invoice.findMany({ where: { accountId: account.id }, select: { id: true, returnOfId: true, isVoided: true } }),
        tx.treasuryTransaction.findMany({ where: { accountId: account.id }, select: { id: true, status: true } }),
        tx.customerVehicle.count({ where: { accountId: account.id } }),
        tx.accountCheck.findMany({ where: { accountId: account.id }, select: { id: true, status: true } }),
        tx.installmentPlan.findMany({ where: { accountId: account.id }, select: { id: true, status: true } }),
        tx.heldSale.findMany({ where: { accountId: account.id }, select: { id: true, status: true } }),
        tx.invoice.count({ where: { accountId: account.id, isVoided: false } }),
        tx.treasuryTransaction.count({ where: { accountId: account.id, status: { not: "VOIDED" } } }),
        tx.accountCheck.count({ where: { accountId: account.id, status: { notIn: ["CANCELLED", "VOIDED"] } } }),
        tx.installmentPlan.count({ where: { accountId: account.id, status: { notIn: ["CANCELLED", "VOIDED"] } } }),
        tx.heldSale.count({ where: { accountId: account.id, status: { not: "CANCELLED" } } }),
      ]);
      if (activeInvoices || activeTransactions || activeChecks || activeInstallmentPlans || activeHeldSales) {
        throw new BusinessRuleError("لا يمكن الحذف الإجباري لأن الحساب يحتوي على مستندات أو سندات أو شيكات أو أقساط أو مسودات نشطة. استخدم الأرشفة للحفاظ على سلامة القيود.");
      }

      const invoiceIds = invoices.map((invoice) => invoice.id);
      if (invoiceIds.length) {
        await tx.heldSale.updateMany({ where: { accountId: account.id, invoiceId: { in: invoiceIds } }, data: { invoiceId: null } });
        await tx.stockMovement.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await tx.treasuryTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        const returnInvoiceIds = invoices.filter((invoice) => invoice.returnOfId).map((invoice) => invoice.id);
        const originalInvoiceIds = invoices.filter((invoice) => !invoice.returnOfId).map((invoice) => invoice.id);
        if (returnInvoiceIds.length) await tx.invoice.deleteMany({ where: { id: { in: returnInvoiceIds } } });
        if (originalInvoiceIds.length) await tx.invoice.deleteMany({ where: { id: { in: originalInvoiceIds } } });
      }
      await tx.heldSale.deleteMany({ where: { accountId: account.id, status: "CANCELLED" } });
      await tx.treasuryTransaction.deleteMany({ where: { accountId: account.id, status: "VOIDED" } });
      await tx.accountCheck.deleteMany({ where: { accountId: account.id, status: { in: ["CANCELLED", "VOIDED"] } } });
      await tx.installmentPlan.deleteMany({ where: { accountId: account.id, status: { in: ["CANCELLED", "VOIDED"] } } });
      await tx.customerVehicle.deleteMany({ where: { accountId: account.id } });
      await tx.account.delete({ where: { id: account.id } });
      await writeAudit(tx, { tableName: "Account", recordId: account.id, action: "DELETE", oldData: { accountNumber: account.accountNumber, name: account.name, currentBalance: account.currentBalance }, newData: { event: "ACCOUNT_FORCE_DELETE_TEST_DATA", reason: input.reason, removed: { invoices: invoices.length, transactions: transactions.length, vehicles, checks: checks.length, installmentPlans: installmentPlans.length, heldSales: heldSales.length } }, performedBy: user.id });
      return { accountNumber: account.accountNumber, removed: { invoices: invoices.length, transactions: transactions.length, vehicles, checks: checks.length, installmentPlans: installmentPlans.length, heldSales: heldSales.length } };
    }, TX_OPTIONS));
    revalidatePath("/accounts");
    revalidatePath("/pos");
    revalidatePath("/invoices");
    revalidatePath("/inventory");
    revalidatePath("/treasury");
    return ok(result);
  } catch (error) {
    return toActionError(error, "deleteAccountCascadeAction");
  }
}

export async function deleteAccountsAction(raw: { accountIds: string[] }): Promise<ActionResult<{ deleted: number }>> {
  try {
    const user = await requirePermission("account.write");
    const ids = [...new Set(raw.accountIds)];
    if (!ids.length || ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new BusinessRuleError("اختر حساباً صالحاً للحذف.");
    const result = await prisma.$transaction(async (tx) => {
      const accounts = await tx.account.findMany({
        where: { id: { in: ids } },
        include: { _count: { select: { invoices: true, transactions: true, heldSales: true, checks: true, installmentPlans: true, vehicles: true } } },
      });
      if (accounts.length !== ids.length) throw new BusinessRuleError("أحد الحسابات المحددة لم يعد موجوداً.");
      for (const account of accounts) {
        const history = Object.values(account._count).reduce((total, count) => total + count, 0);
        if (!account.currentBalance.eq(0) || history > 0) throw new BusinessRuleError(`لا يمكن حذف الحساب "${account.name}" لوجود رصيد أو فواتير أو سندات أو بيانات تشغيلية مرتبطة به.`);
      }
      await tx.account.deleteMany({ where: { id: { in: ids } } });
      for (const account of accounts) await writeAudit(tx, { tableName: "Account", recordId: account.id, action: "DELETE", oldData: account, newData: { purged: true }, performedBy: user.id });
      return { deleted: accounts.length };
    }, TX_OPTIONS);
    revalidatePath("/accounts");
    revalidatePath("/pos");
    return ok(result);
  } catch (error) {
    return toActionError(error, "deleteAccountsAction");
  }
}

"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";
import { money, num } from "@/lib/utils";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";

const CONFIRMATION_PHRASE = "دمج حسابين";
const mergeInputSchema = z.object({
  sourceAccountId: z.string().uuid(),
  targetAccountId: z.string().uuid(),
  confirmation: z.literal(CONFIRMATION_PHRASE),
  reason: z.string().trim().min(10, "سبب الدمج مطلوب ويجب أن يتكون من ١٠ أحرف على الأقل.").max(500),
}).refine((value) => value.sourceAccountId !== value.targetAccountId, "اختر حسابين مختلفين للدمج.");

const normalizeName = (value: string) => value.trim().toLocaleLowerCase("ar-EG").replace(/[أإآٱ]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ");
const targetNature = (balance: Prisma.Decimal) => balance.lt(0) ? "DEBIT" : balance.gt(0) ? "CREDIT" : "ZERO";

export async function mergeDuplicateAccountsAction(raw: unknown): Promise<ActionResult<{ sourceAccountNumber: string; targetAccountNumber: string; moved: { invoices: number; transactions: number; vehicles: number; heldSales: number; checks: number; installmentPlans: number }; targetBalance: number }>> {
  try {
    const user = await requireUser();
    if (user.role !== "SUPER_ADMIN") throw new BusinessRuleError("دمج الحسابات المكررة متاح لمدير النظام فقط.");
    const input = mergeInputSchema.parse(raw);
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
      const result = await withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
        const orderedIds = [input.sourceAccountId, input.targetAccountId].sort();
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Account" WHERE "id" IN (${Prisma.join(orderedIds)}) ORDER BY "id" FOR UPDATE`);
        const accounts = await tx.account.findMany({ where: { id: { in: orderedIds } } });
        if (accounts.length !== 2) throw new BusinessRuleError("تعذر العثور على الحسابين المطلوب دمجهما.");
        const source = accounts.find((account) => account.id === input.sourceAccountId)!;
        const target = accounts.find((account) => account.id === input.targetAccountId)!;
        if (!source.isActive || source.status !== "ACTIVE") throw new BusinessRuleError("الحساب المصدر غير نشط أو مدمج بالفعل.");
        if (!target.isActive || target.status !== "ACTIVE") throw new BusinessRuleError("الحساب الهدف غير نشط.");
        if (source.type !== target.type) throw new BusinessRuleError("لا يمكن دمج حسابين بنوعين مختلفين.");
        if (source.type === "EXPENSE") throw new BusinessRuleError("حسابات المصروفات لا تُدمج بهذه الأداة.");
        if (normalizeName(source.name) !== normalizeName(target.name)) throw new BusinessRuleError("دمج الحسابات متاح فقط للحسابات ذات الاسم المطابق بعد التطبيع العربي.");

        const [sourceChecks, targetChecks, invoices, transactions, vehicles, heldSales, installmentPlans] = await Promise.all([
          tx.accountCheck.findMany({ where: { accountId: source.id }, select: { direction: true, checkNumber: true } }),
          tx.accountCheck.findMany({ where: { accountId: target.id }, select: { direction: true, checkNumber: true } }),
          tx.invoice.count({ where: { accountId: source.id } }),
          tx.treasuryTransaction.count({ where: { accountId: source.id } }),
          tx.customerVehicle.count({ where: { accountId: source.id } }),
          tx.heldSale.count({ where: { accountId: source.id } }),
          tx.installmentPlan.count({ where: { accountId: source.id } }),
        ]);
        const targetCheckKeys = new Set(targetChecks.map((check) => `${check.direction}:${check.checkNumber}`));
        const duplicateCheck = sourceChecks.find((check) => targetCheckKeys.has(`${check.direction}:${check.checkNumber}`));
        if (duplicateCheck) throw new BusinessRuleError(`لا يمكن الدمج لأن الشيك ${duplicateCheck.checkNumber} مكرر في الحسابين.`);

        const previousTargetBalance = money(target.currentBalance);
        const previousSourceBalance = money(source.currentBalance);
        const nextTargetBalance = money(previousTargetBalance.add(previousSourceBalance));
        await Promise.all([
          tx.invoice.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } }),
          tx.treasuryTransaction.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } }),
          tx.customerVehicle.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } }),
          tx.heldSale.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } }),
          tx.accountCheck.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } }),
          tx.installmentPlan.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } }),
        ]);
        const updatedTarget = await tx.account.update({ where: { id: target.id }, data: { currentBalance: nextTargetBalance } });
        const archivedSource = await tx.account.update({ where: { id: source.id }, data: { currentBalance: money(0), isActive: false, status: "INACTIVE", category: `MERGED_INTO:${target.accountNumber}` } });
        const targetAdjustment = await tx.accountBalanceAdjustment.create({ data: { accountId: target.id, previousBalance: previousTargetBalance, targetBalance: nextTargetBalance, delta: previousSourceBalance, targetNature: targetNature(nextTargetBalance), reason: input.reason, createdByUser: user.id, createdByName: user.fullName } });
        const sourceAdjustment = await tx.accountBalanceAdjustment.create({ data: { accountId: source.id, previousBalance: previousSourceBalance, targetBalance: money(0), delta: previousSourceBalance.negated(), targetNature: "ZERO", reason: input.reason, createdByUser: user.id, createdByName: user.fullName } });
        const moved = { invoices, transactions, vehicles, heldSales, checks: sourceChecks.length, installmentPlans };
        await writeAudit(tx, { tableName: "Account", recordId: target.id, action: "UPDATE", oldData: target, newData: { ...updatedTarget, event: "DUPLICATE_ACCOUNT_MERGE_TARGET", sourceAccountId: source.id, sourceAccountNumber: source.accountNumber, moved, previousBalance: previousTargetBalance, targetBalance: nextTargetBalance, reason: input.reason, adjustmentId: targetAdjustment.id }, performedBy: user.id });
        await writeAudit(tx, { tableName: "Account", recordId: source.id, action: "UPDATE", oldData: source, newData: { ...archivedSource, event: "DUPLICATE_ACCOUNT_MERGED_AND_ARCHIVED", targetAccountId: target.id, targetAccountNumber: target.accountNumber, moved, previousBalance: previousSourceBalance, targetBalance: 0, reason: input.reason, adjustmentId: sourceAdjustment.id }, performedBy: user.id });
        return { sourceAccountNumber: source.accountNumber, targetAccountNumber: target.accountNumber, moved, targetBalance: num(nextTargetBalance) };
      }, TX_OPTIONS));
      for (const path of ["/accounts", "/pos", "/invoices", "/treasury", "/vouchers", "/reports/daily-movement", "/"]) revalidatePath(path);
      return ok(result);
    });
  } catch (error) { return toActionError(error, "mergeDuplicateAccountsAction"); }
}

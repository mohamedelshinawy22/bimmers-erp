"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { rebuildAccountBalanceFromLedger } from "@/lib/account-balance-reconciliation";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth";
import { BusinessRuleError } from "@/lib/errors";
import { money, num } from "@/lib/utils";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { TX_OPTIONS, withTxRetry } from "@/server/services/tx";

const CONFIRMATION_PHRASE = "مطابقة أرصدة الحسابات";
const reconciliationRowSchema = z.object({
  sourceRowNumber: z.coerce.number().int().positive(),
  accountNumber: z.string().trim().max(80).optional().default(""),
  name: z.string().trim().min(2).max(180),
  openingBalance: z.coerce.number().finite().min(-99_999_999.99).max(99_999_999.99),
});
const reconciliationInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("TRANSACTIONS"), confirmation: z.literal(CONFIRMATION_PHRASE), reason: z.string().trim().min(10, "سبب المطابقة مطلوب ويجب أن يتكون من ١٠ أحرف على الأقل.").max(500) }),
  z.object({ mode: z.literal("EXCEL"), confirmation: z.literal(CONFIRMATION_PHRASE), reason: z.string().trim().min(10, "سبب المطابقة مطلوب ويجب أن يتكون من ١٠ أحرف على الأقل.").max(500), rows: z.array(reconciliationRowSchema).min(1).max(5_000) }),
]);

const normalized = (value: string) => value.trim().toLocaleLowerCase("ar-EG").replace(/[أإآٱ]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ");
const targetNature = (balance: Prisma.Decimal) => balance.lt(0) ? "DEBIT" : balance.gt(0) ? "CREDIT" : "ZERO";

export async function reconcileAccountBalancesAction(raw: unknown): Promise<ActionResult<{ mode: "TRANSACTIONS" | "EXCEL"; affected: number; unchanged: number; totalDelta: number }>> {
  try {
    const user = await requirePermission("account.write");
    if (user.role !== "SUPER_ADMIN" && user.role !== "MANAGER") throw new BusinessRuleError("مطابقة أرصدة الحسابات متاحة لمدير النظام أو المدير المالي فقط.");
    const input = reconciliationInputSchema.parse(raw);
    const tenant = await getTenantDbFromSession();
    return tenant.run(async () => {
      const result = await withTxRetry(() => tenant.prisma.$transaction(async (tx) => {
        let accounts = await tx.account.findMany({ orderBy: { id: "asc" } });
        if (accounts.length > 500) throw new BusinessRuleError("عدد الحسابات كبير للمطابقة الموحدة. نفّذ المطابقة على دفعات معتمدة حفاظاً على استجابة النظام.");
        if (accounts.length) {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Account" ORDER BY "id" FOR UPDATE`);
          accounts = await tx.account.findMany({ orderBy: { id: "asc" } });
        }

        const targets = new Map<string, Prisma.Decimal>();
        if (input.mode === "TRANSACTIONS") {
          const [invoices, transactions] = await Promise.all([
            tx.invoice.findMany({ select: { accountId: true, type: true, remainingAmount: true, isVoided: true } }),
            tx.treasuryTransaction.findMany({ select: { accountId: true, invoiceId: true, type: true, amount: true, status: true } }),
          ]);
          const accountInvoices = new Map<string, Array<{ type: "SALE" | "PURCHASE" | "SALE_RETURN" | "PURCHASE_RETURN" | "PRICE_QUOTATION"; remainingAmount: number; isVoided: boolean }>>();
          const accountTransactions = new Map<string, Array<{ type: "RECEIPT" | "PAYMENT" | "TRANSFER"; amount: number; status: string; invoiceId: string | null }>>();
          for (const invoice of invoices) {
            const list = accountInvoices.get(invoice.accountId) ?? [];
            list.push({ type: invoice.type, remainingAmount: num(invoice.remainingAmount), isVoided: invoice.isVoided });
            accountInvoices.set(invoice.accountId, list);
          }
          for (const transaction of transactions) {
            if (!transaction.accountId) continue;
            const list = accountTransactions.get(transaction.accountId) ?? [];
            list.push({ type: transaction.type, amount: num(transaction.amount), status: transaction.status, invoiceId: transaction.invoiceId });
            accountTransactions.set(transaction.accountId, list);
          }
          for (const account of accounts) targets.set(account.id, money(rebuildAccountBalanceFromLedger(account.type, accountInvoices.get(account.id) ?? [], accountTransactions.get(account.id) ?? [])));
        } else {
          const byNumber = new Map(accounts.map((account) => [normalized(account.accountNumber), account]));
          const byName = new Map<string, typeof accounts[number]>();
          for (const account of accounts) {
            const key = normalized(account.name);
            if (byName.has(key)) throw new BusinessRuleError(`يوجد أكثر من حساب باسم «${account.name}». استخدم رقم الحساب المطابق من ملف Excel.`);
            byName.set(key, account);
          }
          const used = new Set<string>();
          const missing: number[] = [];
          for (const row of input.rows) {
            const account = (row.accountNumber ? byNumber.get(normalized(row.accountNumber)) : undefined) ?? byName.get(normalized(row.name));
            if (!account || used.has(account.id)) { missing.push(row.sourceRowNumber); continue; }
            used.add(account.id);
            targets.set(account.id, money(row.openingBalance));
          }
          if (missing.length) throw new BusinessRuleError(`تعذر مطابقة ${missing.length} صف من ملف Excel مع حسابات المستأجر. راجع أرقام الحسابات أو الأسماء قبل أي كتابة.`);
        }

        let affected = 0;
        let unchanged = 0;
        let totalDelta = money(0);
        for (const account of accounts) {
          const target = targets.get(account.id);
          if (!target) { unchanged += 1; continue; }
          const previous = money(account.currentBalance);
          const delta = money(target.sub(previous));
          if (delta.eq(0)) { unchanged += 1; continue; }
          const updated = await tx.account.update({ where: { id: account.id }, data: { currentBalance: target } });
          const adjustment = await tx.accountBalanceAdjustment.create({ data: { accountId: account.id, previousBalance: previous, targetBalance: target, delta, targetNature: targetNature(target), reason: input.reason, createdByUser: user.id, createdByName: user.fullName } });
          await writeAudit(tx, { tableName: "AccountBalanceAdjustment", recordId: adjustment.id, action: "INSERT", newData: { event: input.mode === "TRANSACTIONS" ? "ACCOUNT_BALANCE_REBUILT_FROM_POSTED_LEDGER" : "ACCOUNT_BALANCE_SET_FROM_EXCEL_BASELINE", accountId: account.id, accountNumber: account.accountNumber, accountName: account.name, previousBalance: previous, targetBalance: target, delta, reason: input.reason }, performedBy: user.id });
          await writeAudit(tx, { tableName: "Account", recordId: account.id, action: "UPDATE", oldData: account, newData: { ...updated, event: input.mode === "TRANSACTIONS" ? "ACCOUNT_LEDGER_RECONCILIATION" : "ACCOUNT_EXCEL_BASELINE_RECONCILIATION", previousBalance: previous, targetBalance: target, delta, reason: input.reason }, performedBy: user.id });
          affected += 1;
          totalDelta = money(totalDelta.add(delta));
        }
        return { mode: input.mode, affected, unchanged, totalDelta: num(totalDelta) };
      }, TX_OPTIONS));
      for (const path of ["/accounts", "/pos", "/invoices", "/treasury", "/vouchers", "/reports/daily-movement", "/"]) revalidatePath(path);
      return ok(result);
    });
  } catch (error) { return toActionError(error, "reconcileAccountBalancesAction"); }
}

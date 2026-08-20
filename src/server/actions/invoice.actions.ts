"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { invalidateCache } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { can, requirePermission } from "@/lib/auth";
import { canUseTreasury, getUserAccess, hasPermission } from "@/lib/user-permissions";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import {
  createSaleInvoiceSchema,
  createPurchaseInvoiceSchema,
  voidInvoiceSchema,
  createInvoiceReturnSchema,
  updateSaleInvoiceSchema,
  updatePurchaseInvoiceSchema,
  type CreateSaleInvoiceInput,
  type CreatePurchaseInvoiceInput,
  type CreateInvoiceReturnInput,
  type UpdateSaleInvoiceInput,
  type UpdatePurchaseInvoiceInput,
  type VoidInvoiceInput,
} from "@/lib/validations/invoice";
import {
  createPurchaseInvoice,
  createSaleInvoice,
  updateSaleInvoice,
  updatePurchaseInvoice,
  createInvoiceReturn,
  voidInvoice,
  purgeReturnInvoice,
  purgeInvoice,
  type InvoiceResult,
} from "@/server/services/invoice.service";

export type { InvoiceResult };

/**
 * Server actions are intentionally thin: authenticate → authorise → validate →
 * delegate to the transactional engine → invalidate caches. All ACID logic
 * lives in `invoice.service.ts` so it can be exercised by the concurrency
 * test suite without a browser session.
 */

async function revalidateAfterInvoice(paths: string[]) {
  await invalidateCache("dashboard");
  for (const path of paths) revalidatePath(path);
}

export async function createSaleInvoiceAction(
  raw: CreateSaleInvoiceInput,
): Promise<ActionResult<InvoiceResult>> {
  try {
    const user = await requirePermission("invoice.sale");
    const input = createSaleInvoiceSchema.parse(raw);
    const access = await getUserAccess(user.id);

    const result = await createSaleInvoice(input, {
      id: user.id,
      // Client-sent override flags are only honoured if the role actually holds
      // the permission — the server never trusts the request alone.
      canSellBelowMin: can(user.role, "invoice.belowMinPrice") && hasPermission(access, "canSellBelowMinPrice"),
      canOverrideDiscount: input.allowDiscountOverride && can(user.role, "invoice.overrideDiscount"),
      canAddDiscount: hasPermission(access, "canAddDiscount"),
      maxDiscountPercent: Number(access.permissions?.maxDiscountPercent ?? 100),
      maxDiscountValue: Number(access.permissions?.maxDiscountValue ?? 99_999_999),
      canUseTreasury: (treasuryId) => canUseTreasury(access, treasuryId),
    });

    await revalidateAfterInvoice(["/", "/pos", "/inventory", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "createSaleInvoiceAction");
  }
}

export async function createPurchaseInvoiceAction(
  raw: CreatePurchaseInvoiceInput,
): Promise<ActionResult<InvoiceResult>> {
  try {
    const user = await requirePermission("invoice.purchase");
    const input = createPurchaseInvoiceSchema.parse(raw);

    const result = await createPurchaseInvoice(input, {
      id: user.id,
      canSellBelowMin: can(user.role, "invoice.belowMinPrice"),
      canOverrideDiscount: can(user.role, "invoice.overrideDiscount"),
    });

    await revalidateAfterInvoice(["/", "/inventory", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "createPurchaseInvoiceAction");
  }
}

export async function updateSaleInvoiceAction(raw: UpdateSaleInvoiceInput): Promise<ActionResult<InvoiceResult>> {
  try {
    const user = await requirePermission("invoice.sale");
    const input = updateSaleInvoiceSchema.parse(raw);
    const access = await getUserAccess(user.id);
    const result = await updateSaleInvoice(input, { id: user.id, canSellBelowMin: can(user.role, "invoice.belowMinPrice") && hasPermission(access, "canSellBelowMinPrice"), canOverrideDiscount: can(user.role, "invoice.overrideDiscount"), canAddDiscount: hasPermission(access, "canAddDiscount"), maxDiscountPercent: Number(access.permissions?.maxDiscountPercent ?? 100), maxDiscountValue: Number(access.permissions?.maxDiscountValue ?? 99_999_999), canUseTreasury: (treasuryId) => canUseTreasury(access, treasuryId) });
    await revalidateAfterInvoice(["/", "/pos", "/invoices", "/inventory", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "updateSaleInvoiceAction");
  }
}

export async function updatePurchaseInvoiceAction(raw: UpdatePurchaseInvoiceInput): Promise<ActionResult<InvoiceResult>> {
  try {
    const user = await requirePermission("invoice.purchase");
    const input = updatePurchaseInvoiceSchema.parse(raw);
    const result = await updatePurchaseInvoice(input, { id: user.id, canSellBelowMin: can(user.role, "invoice.belowMinPrice"), canOverrideDiscount: can(user.role, "invoice.overrideDiscount") });
    await revalidateAfterInvoice(["/", "/invoices", "/inventory", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "updatePurchaseInvoiceAction");
  }
}

export async function createInvoiceReturnAction(raw: CreateInvoiceReturnInput): Promise<ActionResult<InvoiceResult>> {
  try {
    const input = createInvoiceReturnSchema.parse(raw);
    const original = await prisma.invoice.findUnique({ where: { id: input.originalInvoiceId }, select: { type: true } });
    const user = await requirePermission(original?.type === "PURCHASE" ? "invoice.purchase" : "invoice.sale");
    const result = await createInvoiceReturn(input, {
      id: user.id,
      canSellBelowMin: can(user.role, "invoice.belowMinPrice"),
      canOverrideDiscount: can(user.role, "invoice.overrideDiscount"),
    });
    await revalidateAfterInvoice(["/", "/invoices", "/sales/returns", "/purchases/returns", "/inventory", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "createInvoiceReturnAction");
  }
}

export async function createSalesReturnAction(raw: CreateInvoiceReturnInput): Promise<ActionResult<InvoiceResult>> {
  try {
    const input = createInvoiceReturnSchema.parse(raw);
    const original = await prisma.invoice.findUnique({ where: { id: input.originalInvoiceId }, select: { type: true } });
    if (original?.type !== "SALE") return { success: false, error: "يجب اختيار فاتورة بيع أصلية لإنشاء مرتجع البيع." };
    const user = await requirePermission("invoice.sale");
    const result = await createInvoiceReturn(input, { id: user.id, canSellBelowMin: can(user.role, "invoice.belowMinPrice"), canOverrideDiscount: can(user.role, "invoice.overrideDiscount") });
    await revalidateAfterInvoice(["/", "/invoices", "/sales/returns", "/inventory", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "createSalesReturnAction");
  }
}

export async function createPurchaseReturnAction(raw: CreateInvoiceReturnInput): Promise<ActionResult<InvoiceResult>> {
  try {
    const input = createInvoiceReturnSchema.parse(raw);
    const original = await prisma.invoice.findUnique({ where: { id: input.originalInvoiceId }, select: { type: true } });
    if (original?.type !== "PURCHASE") return { success: false, error: "يجب اختيار فاتورة شراء أصلية لإنشاء مرتجع الشراء." };
    const user = await requirePermission("invoice.purchase");
    const result = await createInvoiceReturn(input, { id: user.id, canSellBelowMin: can(user.role, "invoice.belowMinPrice"), canOverrideDiscount: can(user.role, "invoice.overrideDiscount") });
    await revalidateAfterInvoice(["/", "/invoices", "/purchases/returns", "/inventory", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "createPurchaseReturnAction");
  }
}

const purgeReturnSchema = z.object({ invoiceId: z.string().uuid() });
const deleteCancelledInvoiceSchema = z.object({ invoiceId: z.string().uuid(), reason: z.string().trim().max(500).optional().or(z.literal("")) });
const bulkDeleteCancelledInvoicesSchema = z.object({ invoiceIds: z.array(z.string().uuid()).min(1).max(100), reason: z.string().trim().max(500).optional().or(z.literal("")) });

export async function deleteCancelledInvoiceAction(raw: { invoiceId: string; reason?: string }): Promise<ActionResult<{ invoiceNumber: string }>> {
  try {
    const user = await requirePermission("invoice.purge");
    const input = deleteCancelledInvoiceSchema.parse(raw);
    const invoice = await prisma.invoice.findUnique({ where: { id: input.invoiceId }, select: { id: true, type: true, isVoided: true } });
    if (!invoice) return { success: false, error: "الفاتورة غير موجودة." };
    if (!invoice.isVoided) return { success: false, error: "لا يمكن حذف الفاتورة مباشرة؛ يجب إلغاؤها أولاً لضمان سلامة الحسابات والمخزون." };
    if (invoice.type !== "SALE" && invoice.type !== "PURCHASE") return { success: false, error: "هذه العملية متاحة لفواتير البيع والشراء الملغاة فقط." };
    const result = await purgeInvoice(invoice.id, invoice.type, { id: user.id, canSellBelowMin: true, canOverrideDiscount: true, purgeReason: input.reason || "حذف نهائي لفاتورة ملغاة" });
    await revalidateAfterInvoice(["/", "/invoices", "/inventory", "/pos", "/treasury", "/accounts", "/reports/daily-movement"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "deleteCancelledInvoiceAction");
  }
}

export async function bulkDeleteCancelledInvoicesAction(raw: { invoiceIds: string[]; reason?: string }): Promise<ActionResult<{ deleted: string[]; failed: Array<{ id: string; error: string }> }>> {
  try {
    const user = await requirePermission("invoice.purge");
    const input = bulkDeleteCancelledInvoicesSchema.parse(raw);
    const invoices = await prisma.invoice.findMany({ where: { id: { in: input.invoiceIds } }, select: { id: true, type: true, isVoided: true } });
    const found = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const invalid = input.invoiceIds.filter((id) => { const invoice = found.get(id); return !invoice || !invoice.isVoided || (invoice.type !== "SALE" && invoice.type !== "PURCHASE"); });
    if (invalid.length) return { success: false, error: "تتضمن القائمة فواتير غير موجودة أو غير ملغاة؛ لا يمكن تنفيذ الحذف الجماعي." };
    const deleted: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const invoice of invoices) {
      try {
        const result = await purgeInvoice(invoice.id, invoice.type as "SALE" | "PURCHASE", { id: user.id, canSellBelowMin: true, canOverrideDiscount: true, purgeReason: input.reason || "حذف جماعي لفواتير ملغاة" });
        deleted.push(result.invoiceNumber);
      } catch (error) {
        failed.push({ id: invoice.id, error: error instanceof Error ? error.message : "تعذر حذف الفاتورة." });
      }
    }
    if (deleted.length) await revalidateAfterInvoice(["/", "/invoices", "/inventory", "/pos", "/treasury", "/accounts", "/reports/daily-movement"]);
    return ok({ deleted, failed });
  } catch (error) {
    return toActionError(error, "bulkDeleteCancelledInvoicesAction");
  }
}

export async function purgeSalesInvoiceAction(raw: { invoiceId: string }): Promise<ActionResult<{ invoiceNumber: string }>> {
  try {
    const user = await requirePermission("invoice.purge");
    const input = purgeReturnSchema.parse(raw);
    const result = await purgeInvoice(input.invoiceId, "SALE", { id: user.id, canSellBelowMin: true, canOverrideDiscount: true });
    await revalidateAfterInvoice(["/", "/invoices", "/inventory", "/pos", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "purgeSalesInvoiceAction");
  }
}

export async function purgePurchaseInvoiceAction(raw: { invoiceId: string }): Promise<ActionResult<{ invoiceNumber: string }>> {
  try {
    const user = await requirePermission("invoice.purge");
    const input = purgeReturnSchema.parse(raw);
    const result = await purgeInvoice(input.invoiceId, "PURCHASE", { id: user.id, canSellBelowMin: true, canOverrideDiscount: true });
    await revalidateAfterInvoice(["/", "/invoices", "/inventory", "/pos", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "purgePurchaseInvoiceAction");
  }
}

export async function purgeSalesReturnAction(raw: { invoiceId: string }): Promise<ActionResult<{ invoiceNumber: string; wasVoided: boolean }>> {
  try {
    const user = await requirePermission("invoice.purge");
    const input = purgeReturnSchema.parse(raw);
    const result = await purgeReturnInvoice(input.invoiceId, "SALE_RETURN", { id: user.id, canSellBelowMin: true, canOverrideDiscount: true });
    await revalidateAfterInvoice(["/", "/sales/returns", "/purchases/returns", "/invoices", "/inventory", "/pos", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "purgeSalesReturnAction");
  }
}

export async function purgePurchaseReturnAction(raw: { invoiceId: string }): Promise<ActionResult<{ invoiceNumber: string; wasVoided: boolean }>> {
  try {
    const user = await requirePermission("invoice.purge");
    const input = purgeReturnSchema.parse(raw);
    const result = await purgeReturnInvoice(input.invoiceId, "PURCHASE_RETURN", { id: user.id, canSellBelowMin: true, canOverrideDiscount: true });
    await revalidateAfterInvoice(["/", "/sales/returns", "/purchases/returns", "/invoices", "/inventory", "/pos", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "purgePurchaseReturnAction");
  }
}

export async function voidInvoiceAction(
  raw: VoidInvoiceInput,
): Promise<ActionResult<{ invoiceNumber: string }>> {
  try {
    const user = await requirePermission("invoice.void");
    const input = voidInvoiceSchema.parse(raw);

    const result = await voidInvoice(input, {
      id: user.id,
      canSellBelowMin: true,
      canOverrideDiscount: true,
    });

    await revalidateAfterInvoice(["/", "/inventory", "/treasury", "/accounts"]);
    return ok(result);
  } catch (error) {
    return toActionError(error, "voidInvoiceAction");
  }
}

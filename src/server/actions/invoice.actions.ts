"use server";

import { revalidatePath } from "next/cache";
import { invalidateCache } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { can, requirePermission } from "@/lib/auth";
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

    const result = await createSaleInvoice(input, {
      id: user.id,
      // Client-sent override flags are only honoured if the role actually holds
      // the permission — the server never trusts the request alone.
      canSellBelowMin: can(user.role, "invoice.belowMinPrice"),
      canOverrideDiscount: input.allowDiscountOverride && can(user.role, "invoice.overrideDiscount"),
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
    const result = await updateSaleInvoice(input, { id: user.id, canSellBelowMin: can(user.role, "invoice.belowMinPrice"), canOverrideDiscount: can(user.role, "invoice.overrideDiscount") });
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

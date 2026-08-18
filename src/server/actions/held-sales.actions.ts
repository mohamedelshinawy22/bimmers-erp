"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { ok, toActionError, type ActionResult } from "@/lib/action-result";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";

interface HeldSaleInput { accountId?: string; treasuryId?: string; paymentMethod: "CASH" | "VISA" | "SPLIT" | "ON_ACCOUNT"; discountAmount: number; taxAmount: number; paidAmount: number; notes?: string; items: Array<{ partId: string; quantity: number; unitPrice: number; lineDiscount: number }>; }

export async function holdSaleAction(raw: HeldSaleInput): Promise<ActionResult<{ id: string; holdNumber: string }>> {
  try {
    const user = await requirePermission("pos.hold");
    if (!raw.items.length) return { success: false, error: "لا يمكن تعليق فاتورة بلا أصناف." };
    const result = await prisma.$transaction(async (tx) => {
      const subtotal = raw.items.reduce((sum, line) => sum + line.quantity * line.unitPrice - line.lineDiscount, 0);
      const sequence = await tx.heldSale.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } });
      const created = await tx.heldSale.create({ data: { holdNumber: `HLD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(sequence + 1).padStart(3, "0")}`, userId: user.id, accountId: raw.accountId || null, treasuryId: raw.treasuryId || null, paymentMethod: raw.paymentMethod, subtotal, discountAmount: raw.discountAmount, taxAmount: raw.taxAmount, paidAmount: raw.paidAmount, notes: raw.notes || null, items: { create: raw.items } } });
      await writeAudit(tx, { tableName: "HeldSale", recordId: created.id, action: "INSERT", newData: created, performedBy: user.id });
      return created;
    });
    revalidatePath("/pos");
    return ok({ id: result.id, holdNumber: result.holdNumber });
  } catch (error) { return toActionError(error, "holdSaleAction"); }
}

export async function listHeldSalesAction(): Promise<ActionResult<Array<{ id: string; holdNumber: string; createdAt: string; itemCount: number }>>> {
  try {
    const user = await requirePermission("pos.hold");
    const rows = await prisma.heldSale.findMany({ where: { status: "HELD", OR: [{ userId: user.id }, { user: { role: { in: ["SUPER_ADMIN", "MANAGER"] } } }] }, select: { id: true, holdNumber: true, createdAt: true, _count: { select: { items: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
    return ok(rows.map((row) => ({ id: row.id, holdNumber: row.holdNumber, createdAt: row.createdAt.toISOString(), itemCount: row._count.items })));
  } catch (error) { return toActionError(error, "listHeldSalesAction"); }
}

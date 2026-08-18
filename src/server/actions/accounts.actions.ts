"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth";
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
import { TX_OPTIONS } from "@/server/services/tx";

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
            currentBalance: money(input.openingBalance),
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

export async function updateAccountAction(raw: UpdateAccountInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requirePermission("account.write");
    const input = updateAccountSchema.parse(raw);

    await prisma.$transaction(async (tx) => {
      const before = await tx.account.findUnique({ where: { id: input.id } });
      if (!before) throw new BusinessRuleError("الحساب غير موجود.");

      /**
       * Guard: don't strand an existing debt above a newly lowered credit limit.
       *
       * The `newLimit > 0` condition used to be part of this check, which meant
       * lowering the limit to exactly 0 — the most damaging value, since
       * `createSaleInvoice` treats 0 as "no credit sales at all" — skipped the
       * guard entirely and left an account owing money above a zero limit.
       */
      const newLimit = money(input.creditLimit);
      if (before.currentBalance.lt(0) && before.currentBalance.abs().gt(newLimit)) {
        throw new BusinessRuleError(
          `لا يمكن تخفيض حد الائتمان إلى ${formatMoney(newLimit)} ` +
            `والمديونية الحالية ${formatMoney(before.currentBalance.abs())}. سدّد الرصيد أولاً.`,
        );
      }

      if (!input.isActive && !before.currentBalance.eq(0)) {
        throw new BusinessRuleError("لا يمكن إيقاف حساب له رصيد مفتوح. قم بتسوية الرصيد أولاً.");
      }

      const updated = await tx.account.update({
        where: { id: input.id },
        data: {
          name: input.name,
          type: input.type,
          phone: input.phone || null,
          email: input.email || null,
          address: input.address || null,
          taxNumber: input.taxNumber || null,
          creditLimit: newLimit,
          defaultPriceTier: input.defaultPriceTier,
          category: input.category || null,
          status: input.status,
          isActive: input.isActive && input.status !== "INACTIVE",
        },
      });

      await writeAudit(tx, {
        tableName: "Account",
        recordId: input.id,
        action: "UPDATE",
        oldData: before,
        newData: updated,
        performedBy: user.id,
      });
    });

    revalidatePath("/accounts");
    return ok({ id: input.id });
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
      address: "",
      taxNumber: "",
      category: "",
      creditLimit: 0,
      openingBalance: 0,
      status: "ACTIVE",
    });
  } catch (error) {
    return toActionError(error, "createQuickPosAccountAction");
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

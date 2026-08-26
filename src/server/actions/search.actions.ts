"use server";

import { requirePermission } from "@/lib/auth";
import { toActionError, ok, type ActionResult } from "@/lib/action-result";
import { quickSearchParts, type PosPartRow } from "@/server/services/parts.service";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { getAccountVehicles, searchPosAccounts, searchSupplierAccounts, type AccountVehicle, type PosAccount } from "@/server/services/accounts.service";
import { z } from "zod";

const posPartSearchFiltersSchema = z.object({
  brandId: z.string().trim().max(80).optional(),
  chassisCode: z.string().trim().max(80).optional(),
  inStockOnly: z.boolean().optional(),
}).optional();

/**
 * Thin authenticated wrapper so the POS can search on keystroke.
 *
 * Returns `PosPartRow`, which deliberately excludes `buyPriceAvg`/`buyPriceLast`.
 * The previous full `PartRow` shipped average cost to any role holding
 * `part.read` — including CASHIER, which `part.viewCost` excludes.
 */
export async function searchPosAccountsAction(query: string): Promise<ActionResult<PosAccount[]>> {
  try {
    await requirePermission("account.read");
    const tenant = await getTenantDbFromSession();
    return ok(await tenant.run(() => searchPosAccounts(query, 30)));
  } catch (error) {
    return toActionError(error, "searchPosAccountsAction");
  }
}

export async function searchSuppliersAction(query: string): Promise<ActionResult<PosAccount[]>> {
  try {
    await requirePermission("account.read");
    const tenant = await getTenantDbFromSession();
    return ok(await tenant.run(() => searchSupplierAccounts(query, 30)));
  } catch (error) {
    return toActionError(error, "searchSuppliersAction");
  }
}

export async function searchPartsForPosAction(query: string, rawFilters?: unknown): Promise<ActionResult<PosPartRow[]>> {
  try {
    await requirePermission("part.read");
    const tenant = await getTenantDbFromSession();
    const filters = posPartSearchFiltersSchema.parse(rawFilters);
    const rows = await tenant.run(() => quickSearchParts(tenant.prisma, query, 15, filters));
    return ok(rows);
  } catch (error) {
    return toActionError(error, "searchPartsForPosAction");
  }
}

/** Loads one account's vehicles when the cashier selects it. */
export async function getAccountVehiclesAction(
  accountId: string,
): Promise<ActionResult<AccountVehicle[]>> {
  try {
    await requirePermission("account.read");
    const tenant = await getTenantDbFromSession();
    return ok(await tenant.run(() => getAccountVehicles(accountId)));
  } catch (error) {
    return toActionError(error, "getAccountVehiclesAction");
  }
}

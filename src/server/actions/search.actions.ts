"use server";

import { requirePermission } from "@/lib/auth";
import { toActionError, ok, type ActionResult } from "@/lib/action-result";
import { quickSearchParts, type PosPartRow } from "@/server/services/parts.service";
import { getAccountVehicles, searchPosAccounts, type AccountVehicle, type PosAccount } from "@/server/services/accounts.service";

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
    return ok(await searchPosAccounts(query, 30));
  } catch (error) {
    return toActionError(error, "searchPosAccountsAction");
  }
}

export async function searchPartsForPosAction(query: string): Promise<ActionResult<PosPartRow[]>> {
  try {
    await requirePermission("part.read");
    const rows = await quickSearchParts(query, 12);
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
    return ok(await getAccountVehicles(accountId));
  } catch (error) {
    return toActionError(error, "getAccountVehiclesAction");
  }
}

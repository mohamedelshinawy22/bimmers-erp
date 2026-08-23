import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { can, requireUser } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { canUseTreasury, getUserAccess, hasApplicationPermission, hasPermission } from "@/lib/user-permissions";
import { getPosAccounts } from "@/server/services/accounts.service";
import { getSetting } from "@/server/services/settings.service";
import { PosTerminal } from "./pos-terminal";

export const metadata = { title: "نقطة البيع" };
export const dynamic = "force-dynamic";

export default async function PosPage() {
  const tenant = await getTenantDbFromSession();
  const user = tenant.user;
  return tenant.run(async () => {
  const access = await getUserAccess(user.id);
  if (!hasApplicationPermission(access, "invoice.sale")) redirect("/");

  const [accounts, allTreasuries, taxRateRaw, companyName, enforceCredit, allowNegative, receiptFooter] =
    await Promise.all([
      getPosAccounts(),
      prisma.treasury.findMany({
        where: { isActive: true },
        orderBy: [{ type: "asc" }, { name: "asc" }],
        select: { id: true, name: true, type: true },
      }),
      getSetting("TAX_RATE_PERCENT", "0"),
      getSetting("COMPANY_NAME", "BimmerERP"),
      getSetting("ENFORCE_CREDIT_LIMIT", "true"),
      getSetting("ALLOW_NEGATIVE_STOCK", "false"),
      getSetting("INVOICE_FOOTER", ""),
    ]);

  const treasuries = allTreasuries.filter((treasury) => canUseTreasury(access, treasury.id));
  const walkIn = accounts.find((a) => a.accountNumber === "ACC-0001") ?? accounts[0] ?? null;
  const cashDrawer = treasuries.find((t) => t.type === "CASH_DRAWER") ?? treasuries[0] ?? null;
  const taxRatePercent = Math.min(100, Math.max(0, Number(taxRateRaw) || 0));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue">
          <Receipt size={22} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">نقطة البيع السريعة</h1>
          <p className="text-xs text-bmw-muted">
            بحث فوري بالباركود / OEM • خصم مخزون ذرّي • F8 للبحث • F9 للدفع
          </p>
        </div>
      </div>

      <PosTerminal
        accounts={accounts}
        treasuries={treasuries}
        defaultAccountId={walkIn?.id ?? null}
        defaultTreasuryId={cashDrawer?.id ?? null}
        canOverrideMinPrice={can(user.role, "invoice.belowMinPrice") && hasPermission(access, "canSellBelowMinPrice")}
        taxRatePercent={taxRatePercent}
        companyName={companyName}
        enforceCreditLimit={enforceCredit === "true"}
        allowNegativeStock={allowNegative === "true" && hasPermission(access, "canNegativeSell")}
        receiptFooter={receiptFooter}
      />
    </div>
  );
  });
}

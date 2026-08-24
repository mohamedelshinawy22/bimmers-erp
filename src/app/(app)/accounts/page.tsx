import { redirect } from "next/navigation";
import type { AccountType } from "@prisma/client";
import { can, requireUser } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { num } from "@/lib/utils";
import { getVehicleFormOptions, listAccounts } from "@/server/services/accounts.service";
import { getCompanyProfile } from "@/server/services/settings.service";
import { AccountsClient } from "./accounts-client";

export const metadata = { title: "الحسابات والورش" };
export const dynamic = "force-dynamic";

const VALID_TYPES: AccountType[] = ["CUSTOMER", "WORKSHOP_BMW", "SUPPLIER", "EXPENSE"];

interface PageProps {
  searchParams: { q?: string; type?: string; debtors?: string; balance?: string; archived?: string; page?: string };
}

export default async function AccountsPage({ searchParams }: PageProps) {
  const tenant = await getTenantDbFromSession();
  const user = tenant.user;
  return tenant.run(async () => {
  if (!can(user.role, "account.read")) redirect("/");

  const rawType = searchParams.type ?? "";
  const type = VALID_TYPES.includes(rawType as AccountType) ? (rawType as AccountType) : "ALL";
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const debtorsOnly = searchParams.debtors === "1";
  const balanceFilter = searchParams.balance === "DEBIT" || searchParams.balance === "CREDIT" || searchParams.balance === "ZERO" ? searchParams.balance : "ALL";
  const includeInactive = searchParams.archived === "1";

  const [result, options, workshops, company, treasuries] = await Promise.all([
    listAccounts({ query: searchParams.q, type, debtorsOnly, balanceFilter, includeInactive, page, pageSize: 25 }),
    getVehicleFormOptions(),
    tenant.prisma.account.count({ where: { type: "WORKSHOP_BMW", isActive: true } }).catch(() => 0),
    getCompanyProfile(tenant.prisma),
    tenant.prisma.treasury.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, currentBalance: true } }).catch(() => []),
  ]);

  return (
    <AccountsClient
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      filters={{ query: searchParams.q ?? "", type: type === "ALL" ? "" : type, debtorsOnly, balanceFilter, includeInactive }}
      options={options}
      canWrite={can(user.role, "account.write")}
      canForceCleanup={user.role === "SUPER_ADMIN"}
      canAdjustBalance={user.role === "SUPER_ADMIN" || user.role === "MANAGER"}
      canViewStatement={can(user.role, "account.viewStatement")}
      company={company}
      canTransact={can(user.role, "treasury.transact")}
      treasuries={treasuries.map((treasury) => ({ ...treasury, currentBalance: num(treasury.currentBalance) }))}
      totals={{
        receivables: result.summary.receivables,
        payables: result.summary.payables,
        net: result.summary.net,
        debitCount: result.summary.debitCount,
        creditCount: result.summary.creditCount,
        zeroCount: result.summary.zeroCount,
        workshops,
      }}
    />
  );
  });
}

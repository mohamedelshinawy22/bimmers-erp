import { redirect } from "next/navigation";
import type { AccountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { can, requireUser } from "@/lib/auth";
import { num } from "@/lib/utils";
import { getVehicleFormOptions, listAccounts } from "@/server/services/accounts.service";
import { getCompanyProfile } from "@/server/services/settings.service";
import { AccountsClient } from "./accounts-client";

export const metadata = { title: "الحسابات والورش" };
export const dynamic = "force-dynamic";

const VALID_TYPES: AccountType[] = ["CUSTOMER", "WORKSHOP_BMW", "SUPPLIER", "EXPENSE"];

interface PageProps {
  searchParams: { q?: string; type?: string; debtors?: string; page?: string };
}

export default async function AccountsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  if (!can(user.role, "account.read")) redirect("/");

  const rawType = searchParams.type ?? "";
  const type = VALID_TYPES.includes(rawType as AccountType) ? (rawType as AccountType) : "ALL";
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);
  const debtorsOnly = searchParams.debtors === "1";

  const [result, options, receivablesAgg, payablesAgg, workshops, company, treasuries] = await Promise.all([
    listAccounts({ query: searchParams.q, type, debtorsOnly, page, pageSize: 25 }),
    getVehicleFormOptions(),
    prisma.account.aggregate({
      where: { type: { in: ["CUSTOMER", "WORKSHOP_BMW"] }, currentBalance: { lt: 0 } },
      _sum: { currentBalance: true },
    }),
    prisma.account.aggregate({
      where: { type: "SUPPLIER", currentBalance: { gt: 0 } },
      _sum: { currentBalance: true },
    }),
    prisma.account.count({ where: { type: "WORKSHOP_BMW", isActive: true } }),
    getCompanyProfile(),
    prisma.treasury.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, currentBalance: true } }),
  ]);

  return (
    <AccountsClient
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      filters={{ query: searchParams.q ?? "", type: type === "ALL" ? "" : type, debtorsOnly }}
      options={options}
      canWrite={can(user.role, "account.write")}
      canViewStatement={can(user.role, "account.viewStatement")}
      companyName={company.name}
      canTransact={can(user.role, "treasury.transact")}
      treasuries={treasuries.map((treasury) => ({ ...treasury, currentBalance: num(treasury.currentBalance) }))}
      totals={{
        receivables: Math.abs(num(receivablesAgg._sum.currentBalance)),
        payables: num(payablesAgg._sum.currentBalance),
        workshops,
      }}
    />
  );
}

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { can, requireUser } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import {
  getClosedShifts,
  getZReport,
  listTreasuries,
  listTreasuryTransactions,
} from "@/server/services/treasury.service";
import { TreasuryClient } from "./treasury-client";
import { getCompanyProfile } from "@/server/services/settings.service";

export const metadata = { title: "الخزينة والسيولة" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { voucher?: string; treasury?: string };
}

export default async function TreasuryPage({ searchParams }: PageProps) {
  const tenant = await getTenantDbFromSession();
  const user = tenant.user;
  return tenant.run(async () => {
  // Cash balances, the Z-report and the full transaction history are all on this
  // page, so the read permission has to gate the page itself — hiding the action
  // buttons is not access control.
  if (!can(user.role, "treasury.read")) redirect("/");

  const treasuries = await listTreasuries();
  // Prefer the treasury with an open shift, else the first cash drawer.
  const focusId =
    (searchParams.treasury && treasuries.find((t) => t.id === searchParams.treasury)?.id) ??
    treasuries.find((t) => t.openShift)?.id ??
    treasuries.find((t) => t.type === "CASH_DRAWER")?.id ??
    treasuries[0]?.id;

  const [transactions, closedShifts, zReport, accounts, company] = await Promise.all([
    listTreasuryTransactions(40),
    getClosedShifts(10),
    focusId ? getZReport(focusId) : Promise.resolve(null),
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      take: 400,
      select: { id: true, name: true, accountNumber: true, type: true },
    }),
    getCompanyProfile(),
  ]);

  const voucher =
    searchParams.voucher === "RECEIPT" || searchParams.voucher === "PAYMENT" ? searchParams.voucher : null;

  return (
    <TreasuryClient
      treasuries={treasuries}
      transactions={transactions}
      closedShifts={closedShifts}
      zReport={zReport}
      accounts={accounts}
      company={company}
      permissions={{
        canTransact: can(user.role, "treasury.transact"),
        canTransfer: can(user.role, "treasury.transfer"),
        canCloseShift: can(user.role, "treasury.closeShift"),
        canManage: can(user.role, "treasury.manage"),
      }}
      initialVoucher={can(user.role, "treasury.transact") ? voucher : null}
    />
  );
  });
}

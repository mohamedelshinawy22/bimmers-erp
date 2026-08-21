import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getCompanyProfile } from "@/server/services/settings.service";
import { getOpenInvoicesForVouchers, getVoucherAccounts, getVoucherFilterTreasuries, getVoucherRegister, normalizeVoucherFilters } from "@/server/services/vouchers.service";
import { VouchersClient } from "./vouchers-client";

export const metadata = { title: "سجل السندات والتحصيلات" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { type?: string; status?: string; treasuryId?: string; q?: string; from?: string; to?: string; action?: string };
}

export default async function VouchersPage({ searchParams }: PageProps) {
  const user = await requireUser();
  if (!can(user.role, "treasury.read")) redirect("/");
  const filters = normalizeVoucherFilters(searchParams);
  const [data, treasuries, accounts, openInvoices, company] = await Promise.all([
    getVoucherRegister({ ...filters, limit: 1_000 }),
    getVoucherFilterTreasuries(),
    getVoucherAccounts(),
    getOpenInvoicesForVouchers(),
    getCompanyProfile(),
  ]);
  return <VouchersClient
    rows={data.rows}
    summary={data.summary}
    filters={{ type: filters.type ?? "ALL", status: filters.status ?? "ALL", treasuryId: filters.treasuryId ?? "", q: filters.query ?? "", from: filters.from?.toISOString() ?? "", to: filters.to?.toISOString() ?? "" }}
    treasuries={treasuries}
    accounts={accounts}
    openInvoices={openInvoices}
    company={company}
    permissions={{ canTransact: can(user.role, "treasury.transact"), canManage: can(user.role, "treasury.manage"), canPurge: user.role === "SUPER_ADMIN" }}
    initialAction={searchParams.action === "new_receipt" ? "RECEIPT" : searchParams.action === "new_payment" ? "PAYMENT" : null}
  />;
}

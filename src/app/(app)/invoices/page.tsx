import { redirect } from "next/navigation";
import type { InvoiceType, PaymentStatus } from "@prisma/client";
import { can, requireUser } from "@/lib/auth";
import { listInvoices } from "@/server/services/invoices.service";
import { getCompanyProfile } from "@/server/services/settings.service";
import { InvoicesClient } from "./invoices-client";

export const metadata = { title: "الفواتير" };
export const dynamic = "force-dynamic";

const TYPES: InvoiceType[] = ["SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN", "PRICE_QUOTATION"];
const STATUSES: PaymentStatus[] = ["PAID", "PARTIAL", "CREDIT"];

interface PageProps {
  searchParams: { q?: string; type?: string; status?: string; voided?: string; page?: string };
}

export default async function InvoicesPage({ searchParams }: PageProps) {
  const user = await requireUser();
  if (!can(user.role, "invoice.read")) redirect("/");

  const rawType = searchParams.type ?? "";
  const rawStatus = searchParams.status ?? "";
  const type = TYPES.includes(rawType as InvoiceType) ? (rawType as InvoiceType) : "ALL";
  const status = STATUSES.includes(rawStatus as PaymentStatus) ? (rawStatus as PaymentStatus) : "ALL";
  const includeVoided = searchParams.voided === "1";
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  const [result, company] = await Promise.all([
    listInvoices({ query: searchParams.q, type, status, includeVoided, page, pageSize: 25 }),
    getCompanyProfile(),
  ]);

  return (
    <InvoicesClient
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      filters={{
        query: searchParams.q ?? "",
        type: type === "ALL" ? "" : type,
        status: status === "ALL" ? "" : status,
        includeVoided,
      }}
      permissions={{
        canVoid: can(user.role, "invoice.void"),
        canViewCost: can(user.role, "part.viewCost"),
      }}
      company={company}
    />
  );
}

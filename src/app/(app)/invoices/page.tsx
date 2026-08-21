import { redirect } from "next/navigation";
import type { InvoiceType, PaymentStatus } from "@prisma/client";
import { can, requireUser } from "@/lib/auth";
import { listInvoices } from "@/server/services/invoices.service";
import { getCompanyProfile } from "@/server/services/settings.service";
import { prisma } from "@/lib/prisma";
import { InvoicesClient } from "./invoices-client";

export const metadata = { title: "الفواتير" };
export const dynamic = "force-dynamic";

const TYPES: InvoiceType[] = ["SALE", "PURCHASE", "SALE_RETURN", "PURCHASE_RETURN"];
const STATUSES: PaymentStatus[] = ["PAID", "PARTIAL", "CREDIT"];

interface PageProps {
  searchParams: { q?: string; type?: string; status?: string; voided?: string; from?: string; to?: string; page?: string };
}

export default async function InvoicesPage({ searchParams }: PageProps) {
  const user = await requireUser();
  if (!can(user.role, "invoice.read")) redirect("/");

  const rawType = searchParams.type ?? "";
  const rawStatus = searchParams.status ?? "";
  const type = TYPES.includes(rawType as InvoiceType) ? (rawType as InvoiceType) : "ALL";
  const status = STATUSES.includes(rawStatus as PaymentStatus) ? (rawStatus as PaymentStatus) : "ALL";
  const voidedOnly = rawStatus === "VOIDED";
  const includeVoided = !voidedOnly && searchParams.voided === "1";
  const parseDate = (value: string | undefined, endOfDay = false) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
    return Number.isNaN(date.getTime()) ? undefined : date;
  };
  const from = parseDate(searchParams.from);
  const to = parseDate(searchParams.to, true);
  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  const [result, company, treasuries] = await Promise.all([
    listInvoices({ query: searchParams.q, type, status, includeVoided, voidedOnly, from, to, page, pageSize: 25 }),
    getCompanyProfile(),
    prisma.treasury.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
        status: voidedOnly ? "VOIDED" : status === "ALL" ? "" : status,
        includeVoided,
        from: searchParams.from ?? "",
        to: searchParams.to ?? "",
      }}
      permissions={{
        canVoid: can(user.role, "invoice.void"),
        canPurge: can(user.role, "invoice.purge"),
        canViewCost: can(user.role, "part.viewCost"),
        canSettle: can(user.role, "treasury.transact"),
      }}
      company={company}
      treasuries={treasuries}
    />
  );
}

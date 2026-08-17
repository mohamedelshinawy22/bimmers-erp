import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getAuditFilters, listAuditTrail } from "@/server/services/audit.service";
import { AuditClient } from "./audit-client";

export const metadata = { title: "سجل التدقيق" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: { table?: string; action?: string; q?: string; record?: string; page?: string };
}

export default async function AuditPage({ searchParams }: PageProps) {
  const user = await requireUser();
  if (!can(user.role, "audit.read")) redirect("/");

  const page = Math.max(1, Number(searchParams.page ?? 1) || 1);

  const [result, options] = await Promise.all([
    listAuditTrail({
      tableName: searchParams.table,
      action: searchParams.action,
      recordId: searchParams.record,
      query: searchParams.q,
      page,
      pageSize: 40,
    }),
    getAuditFilters(),
  ]);

  return (
    <AuditClient
      rows={result.rows}
      total={result.total}
      page={result.page}
      pageSize={result.pageSize}
      filters={{
        tableName: searchParams.table ?? "",
        action: searchParams.action ?? "",
        query: searchParams.q ?? "",
      }}
      options={options}
    />
  );
}

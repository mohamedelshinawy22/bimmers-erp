import { notFound, redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getPartById, getStockLedger } from "@/server/services/parts.service";
import { PartLedgerClient } from "./part-ledger-client";

export const dynamic = "force-dynamic";

export default async function PartLedgerPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!can(user.role, "stock.viewLedger")) redirect("/inventory");
  const [part, rows] = await Promise.all([getPartById(params.id), getStockLedger(params.id, 1000)]);
  if (!part) notFound();
  return <PartLedgerClient part={{ id: part.id, nameAr: part.nameAr, oemNumber: part.oemNumber, stockQuantity: part.stockQuantity }} rows={rows} canVoid={can(user.role, "invoice.void")} />;
}

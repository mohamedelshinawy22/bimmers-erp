import { notFound, redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getPartById, getStockLedger } from "@/server/services/parts.service";
import { getCompanyProfile } from "@/server/services/settings.service";
import { PartLedgerClient } from "./part-ledger-client";

export const dynamic = "force-dynamic";

export default async function PartLedgerPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!can(user.role, "stock.viewLedger")) redirect("/inventory");
  const [part, rows, company] = await Promise.all([getPartById(params.id), getStockLedger(params.id, 1000), getCompanyProfile()]);
  if (!part) notFound();
  return <PartLedgerClient part={{ id: part.id, nameAr: part.nameAr, oemNumber: part.oemNumber, stockQuantity: part.stockQuantity, duplicateOemCount: part.duplicateOemCount, duplicateNameCount: part.duplicateNameCount, duplicateBrands: part.duplicateBrands, brandName: part.brandName, category: part.category, chassisCodes: part.chassisCodes, barcode: part.barcode, sellPriceRetail: part.sellPriceRetail }} company={company} rows={rows} canVoid={can(user.role, "invoice.void")} />;
}

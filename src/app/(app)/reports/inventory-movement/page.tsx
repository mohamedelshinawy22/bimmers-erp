import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import InventoryMovementReportClient from "./inventory-movement-client";

export const metadata = { title: "حركة البضاعة والرواكد" };
export const dynamic = "force-dynamic";

export default async function InventoryMovementReportPage() {
  try {
    await requirePermission("reports.dailyMovement");
  } catch {
    redirect("/");
  }
  return <InventoryMovementReportClient />;
}

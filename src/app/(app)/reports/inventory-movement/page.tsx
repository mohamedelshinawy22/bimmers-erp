import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import InventoryMovementReportClient from "./inventory-movement-client";

export const metadata = { title: "حركة البضاعة والرواكد" };
export const dynamic = "force-dynamic";

export default async function InventoryMovementReportPage() {
  const user = await requireUser();
  if (!can(user.role, "reports.dailyMovement")) redirect("/");
  return <InventoryMovementReportClient />;
}

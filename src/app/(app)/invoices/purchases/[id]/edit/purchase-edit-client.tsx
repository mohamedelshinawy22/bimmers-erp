"use client";

import { useRouter } from "next/navigation";
import { PurchaseInvoiceModal } from "@/app/(app)/inventory/components/purchase-invoice-modal";
import type { PosPartRow } from "@/server/services/parts.service";

type DraftLine = { part: PosPartRow; quantity: number; unitPrice: number; lineDiscount: number };

export function PurchaseEditClient({
  suppliers,
  treasuries,
  taxRatePercent,
  draft,
}: {
  suppliers: Array<{ id: string; name: string; accountNumber: string; currentBalance: number }>;
  treasuries: Array<{ id: string; name: string; currentBalance: number }>;
  taxRatePercent: number;
  draft: { invoiceId: string; accountId: string; treasuryId: string | null; paymentMethod: "CASH" | "VISA" | "ON_ACCOUNT"; discountAmount: number; paidAmount: number; notes: string | null; lines: DraftLine[] };
}) {
  const router = useRouter();
  return <PurchaseInvoiceModal open onClose={() => router.push("/invoices")} suppliers={suppliers} treasuries={treasuries} taxRatePercent={taxRatePercent} initialDraft={draft} />;
}

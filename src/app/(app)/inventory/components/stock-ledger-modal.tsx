"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, Modal } from "@/components/ui/modal";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ARABIC_LABELS, CURRENCY, formatDateTime, formatMoney, formatOemNumber } from "@/lib/utils";
import { getStockLedgerAction } from "@/server/actions/invoices.read.actions";

interface LedgerRow {
  id: string;
  seq: string;
  reason: keyof typeof ARABIC_LABELS.stockReason;
  quantityDelta: number;
  balanceAfter: number;
  unitCost: number;
  performedBy: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceType: string | null;
  partyName: string | null;
  note: string | null;
  createdAt: string;
}

/**
 * Stock ledger drawer — the drill-down that proves a part's balance.
 *
 * Rows are ordered by `seq`, not `createdAt`: concurrent commits share a
 * millisecond, so timestamps tie and the replay order becomes ambiguous.
 */
export function StockLedgerModal({
  part,
  onClose,
  canViewCost,
}: {
  part: { id: string; nameAr: string; oemNumber: string; stockQuantity: number };
  onClose: () => void;
  canViewCost: boolean;
}) {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getStockLedgerAction(part.id).then((res) => {
      if (cancelled) return;
      if (res.success) setRows(res.data as LedgerRow[]);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [part.id]);

  const ledgerSum = rows?.reduce((s, r) => s + r.quantityDelta, 0) ?? 0;
  const reconciles = rows !== null && ledgerSum === part.stockQuantity;

  return (
    <Modal
      open
      onClose={onClose}
      title={`دفتر حركة المخزون — ${part.nameAr}`}
      description={`${formatOemNumber(part.oemNumber)} • الرصيد الحالي ${part.stockQuantity}`}
      size="lg"
    >
      <div className="space-y-3">
        {error ? <Alert variant="error">{error}</Alert> : null}

        {rows !== null ? (
          reconciles ? (
            <Alert variant="success">
              مطابقة سليمة: مجموع الحركات ({ledgerSum}) يساوي رصيد الصنف ({part.stockQuantity}).
            </Alert>
          ) : (
            <Alert variant="error">
              عدم مطابقة: مجموع الحركات ({ledgerSum}) لا يساوي رصيد الصنف ({part.stockQuantity}). قد تكون
              القائمة مقتطعة على آخر ١٠٠ حركة.
            </Alert>
          )
        ) : null}

        <Table>
          <THead>
            <TR>
              <TH>#</TH>
              <TH>السبب</TH>
              <TH>الحركة</TH>
              <TH>الرصيد بعدها</TH>
              {canViewCost ? <TH>تكلفة الوحدة</TH> : null}
              <TH>الفاتورة</TH>
              <TH>الطرف (عميل / مورد)</TH>
              <TH>المستخدم</TH>
              <TH>البيان</TH>
              <TH>التاريخ</TH>
            </TR>
          </THead>
          <TBody>
            {rows === null ? (
              <EmptyState colSpan={canViewCost ? 10 : 9} title="جاري التحميل…" />
            ) : rows.length === 0 ? (
              <EmptyState
                colSpan={canViewCost ? 10 : 9}
                title="لا توجد حركات مسجّلة"
                icon={<History size={30} />}
              />
            ) : (
              rows.map((r) => (
                <TR key={r.id}>
                  <TD className="tabular text-[10px] text-bmw-muted">{r.seq}</TD>
                  <TD>
                    <Badge
                      variant={
                        r.quantityDelta > 0 ? "success" : r.reason === "SALE" ? "blue" : "warning"
                      }
                    >
                      {ARABIC_LABELS.stockReason[r.reason]}
                    </Badge>
                  </TD>
                  <TD
                    className={`tabular font-bold ${r.quantityDelta > 0 ? "text-emerald-400" : "text-bmw-mRed"}`}
                  >
                    {r.quantityDelta > 0 ? "+" : ""}
                    {r.quantityDelta}
                  </TD>
                  <TD className="tabular font-bold text-white">{r.balanceAfter}</TD>
                  {canViewCost ? (
                    <TD className="tabular text-xs text-bmw-muted">
                      {r.unitCost > 0 ? `${formatMoney(r.unitCost)} ${CURRENCY}` : "—"}
                    </TD>
                  ) : null}
                  <TD className="tabular text-xs text-bmw-blue">{r.invoiceNumber ? <a href={`/invoices?q=${encodeURIComponent(r.invoiceNumber)}`} className="underline decoration-dotted hover:text-white">{r.invoiceNumber}</a> : "—"}</TD>
                  <TD className="text-xs text-bmw-muted">{r.partyName ?? "—"}</TD>
                  <TD className="text-xs text-bmw-muted">{r.performedBy}</TD>
                  <TD className="max-w-[200px] truncate text-xs text-bmw-muted">{r.note ?? "—"}</TD>
                  <TD className="tabular whitespace-nowrap text-xs text-bmw-muted">
                    {formatDateTime(r.createdAt)}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </div>
    </Modal>
  );
}

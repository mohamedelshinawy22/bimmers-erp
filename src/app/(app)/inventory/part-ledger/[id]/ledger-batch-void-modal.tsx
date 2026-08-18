"use client";

import { useState, useTransition } from "react";
import { Ban, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, Modal } from "@/components/ui/modal";
import { Field, Textarea } from "@/components/ui/input";
import { voidInvoiceAction } from "@/server/actions/invoice.actions";

type LinkedInvoice = { id: string; number: string };

export function LedgerBatchVoidModal({ invoices, onClose, onDone }: { invoices: LinkedInvoice[]; onClose: () => void; onDone: (voidedCount: number) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      let voided = 0;
      for (const invoice of invoices) {
        const result = await voidInvoiceAction({ invoiceId: invoice.id, reason: reason.trim() || "إلغاء من دفتر حركة الصنف" });
        if (!result.success) {
          setError(voided > 0 ? `تم إلغاء ${voided} فاتورة، ثم تعذر إلغاء ${invoice.number}: ${result.error}` : `تعذر إلغاء ${invoice.number}: ${result.error}`);
          return;
        }
        voided += 1;
      }
      onDone(voided);
    });
  };

  return <Modal open onClose={onClose} title={invoices.length === 1 ? `إلغاء الفاتورة ${invoices[0]?.number ?? ""}` : `إلغاء ${invoices.length} فواتير مرتبطة`} description="الإلغاء محاسبي؛ لا يحذف المستند التاريخي." size="sm" footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>رجوع</Button><Button variant="danger" onClick={submit} loading={pending}><Trash2 size={15} /> تأكيد الإلغاء</Button></>}><div className="space-y-3">{error ? <Alert variant="error">{error}</Alert> : null}<Alert variant="warning"><Ban className="ml-1 inline" size={15} /> سيتم عكس حركات المخزون والحساب والخزينة لكل فاتورة محددة، ووضعها بحالة «ملغاة». لا يمكن التراجع عن هذا الإجراء.</Alert><div className="max-h-40 space-y-1 overflow-auto rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3 font-mono text-xs text-bmw-blue">{invoices.map((invoice) => <p key={invoice.id}>{invoice.number}</p>)}</div><Field label="سبب الإلغاء (اختياري)" hint="يُحفظ في سجل التدقيق لكل فاتورة"><Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثال: إدخال مكرر أو خطأ في المستند" /></Field></div></Modal>;
}

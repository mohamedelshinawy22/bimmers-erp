"use client";

import { useState, useTransition } from "react";
import { Alert, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/input";
import type { AccountRow } from "@/server/services/accounts.service";
import { mergeDuplicateAccountsAction } from "@/server/actions/account-merge.actions";
import { formatMoney } from "@/lib/utils";
import { GitMerge } from "lucide-react";

const CONFIRMATION_PHRASE = "دمج حسابين";

export function MergeDuplicateAccountsModal({ accounts, onClose, onDone }: { accounts: [AccountRow, AccountRow]; onClose: () => void; onDone: () => void }) {
  const [targetId, setTargetId] = useState(accounts[0].id);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const source = accounts.find((account) => account.id !== targetId) ?? accounts[1];
  const target = accounts.find((account) => account.id === targetId) ?? accounts[0];
  const ready = confirmation.trim() === CONFIRMATION_PHRASE && reason.trim().length >= 10;

  const execute = () => startTransition(async () => {
    setError(""); setNotice("");
    const result = await mergeDuplicateAccountsAction({ sourceAccountId: source.id, targetAccountId: target.id, reason, confirmation });
    if (!result.success) { setError(result.error); return; }
    setNotice(`تم دمج الحساب ${result.data.sourceAccountNumber} في ${result.data.targetAccountNumber}. الرصيد الموحد: ${formatMoney(result.data.targetBalance)}.`);
    onDone();
  });

  return <Modal open onClose={onClose} size="lg" title="دمج حسابين مكررين" description="ينقل هذا الإجراء تاريخ الحساب المصدر إلى الحساب الهدف، ثم يؤرشف المصدر. لا يمكن التراجع عنه تلقائياً." footer={<><Button variant="ghost" onClick={onClose} disabled={pending}>إلغاء</Button><Button variant="danger" onClick={execute} disabled={!ready} loading={pending}><GitMerge size={16} />دمج وأرشفة المصدر</Button></>}>
    <div className="space-y-4" dir="rtl">
      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      <div className="rounded-xl border border-bmw-mRed/45 bg-bmw-mRed/10 p-3 text-xs leading-5 text-red-100">سيُنقل إلى الحساب الهدف تاريخ الفواتير والسندات والمركبات والشيكات والأقساط والمسودات. سيُجمع الرصيدان، ثم يُصفّر الحساب المصدر ويؤرشف. الدمج مسموح فقط لاسمين متطابقين بعد التطبيع العربي ومن النوع نفسه، ويُرفض عند تعارض أرقام الشيكات.</div>
      <Field label="الحساب الهدف الذي سيبقى نشطاً"><Select value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={pending}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.accountNumber} — {account.name} ({formatMoney(account.currentBalance)})</option>)}</Select></Field>
      <div className="rounded-xl border border-bmw-cardBorder bg-bmw-carbon/50 p-3 text-sm text-bmw-silver">الحساب المصدر الذي سيُنقل ويؤرشف: <b className="text-white">{source.accountNumber} — {source.name}</b></div>
      <Field label="سبب الدمج للتدقيق المالي (10 أحرف على الأقل)"><Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثال: توحيد حسابين مكررين للعميل بعد مراجعة الفواتير والسندات" disabled={pending} /></Field>
      <Field label={`اكتب العبارة التالية للتأكيد: ${CONFIRMATION_PHRASE}`}><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={CONFIRMATION_PHRASE} className="w-full rounded-lg border border-bmw-cardBorder bg-bmw-carbon px-3 py-2 text-sm text-white outline-none focus:border-bmw-blue" disabled={pending} /></Field>
    </div>
  </Modal>;
}

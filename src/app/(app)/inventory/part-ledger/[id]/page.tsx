import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { can, requireUser } from "@/lib/auth";
import { ARABIC_LABELS, formatDateTime, formatMoney } from "@/lib/utils";
import { getPartById, getStockLedger } from "@/server/services/parts.service";

export const dynamic = "force-dynamic";

export default async function PartLedgerPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  if (!can(user.role, "stock.viewLedger")) redirect("/inventory");
  const [part, rows] = await Promise.all([getPartById(params.id), getStockLedger(params.id, 1000)]);
  if (!part) notFound();
  const totals = rows.reduce((acc, row) => ({ inbound: acc.inbound + Math.max(0, row.quantityDelta), outbound: acc.outbound + Math.abs(Math.min(0, row.quantityDelta)), cost: acc.cost + Math.max(0, row.quantityDelta) * row.unitCost }), { inbound: 0, outbound: 0, cost: 0 });
  return <main className="space-y-4" dir="rtl"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-bold text-white">دفتر حركة الصنف التفصيلي</h1><p className="text-sm text-bmw-muted">{part.nameAr} — {part.oemNumber}</p></div><div className="flex gap-2"><button className="rounded-lg border border-bmw-cardBorder px-3 py-2 text-sm" onClick={() => {}}>طباعة A4</button><Link className="rounded-lg border border-bmw-cardBorder px-3 py-2 text-sm" href="/inventory">إغلاق</Link></div></header><section className="bmw-card grid gap-3 p-4 md:grid-cols-4"><div>الرصيد الحالي: <b>{part.stockQuantity}</b></div><div>إجمالي الوارد: <b>{totals.inbound}</b></div><div>إجمالي الصادر: <b>{totals.outbound}</b></div><div>تكلفة الوارد: <b>{formatMoney(totals.cost)}</b></div></section><section className="bmw-card overflow-x-auto"><table className="w-full text-sm"><thead className="bg-bmw-carbon text-bmw-muted"><tr><th className="p-3">التاريخ والوقت</th><th>الحركة</th><th>وارد</th><th>صادر</th><th>الرصيد</th><th>تكلفة الوحدة</th><th>إجمالي التكلفة</th><th>الفاتورة</th><th>المستخدم</th><th>البيان</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-bmw-cardBorder"><td className="p-3">{formatDateTime(row.createdAt)}</td><td>{ARABIC_LABELS.stockReason[row.reason]}</td><td className="text-emerald-400">{row.quantityDelta > 0 ? row.quantityDelta : "—"}</td><td className="text-bmw-mRed">{row.quantityDelta < 0 ? Math.abs(row.quantityDelta) : "—"}</td><td><b className="rounded bg-bmw-blue/15 px-2 py-1 text-bmw-blue">{row.balanceAfter}</b></td><td>{row.unitCost ? formatMoney(row.unitCost) : "—"}</td><td>{row.unitCost ? formatMoney(Math.abs(row.quantityDelta) * row.unitCost) : "—"}</td><td>{row.invoiceNumber ?? "—"}</td><td>{row.performedBy}</td><td>{row.note ?? "—"}</td></tr>)}</tbody></table></section><footer className="sticky bottom-0 flex flex-wrap justify-between gap-3 border-t border-bmw-cardBorder bg-bmw-card p-3 text-sm"><span>وارد: {totals.inbound}</span><span>صادر: {totals.outbound}</span><span>إجمالي التكلفة: {formatMoney(totals.cost)}</span><span>الرصيد النهائي: <b>{part.stockQuantity}</b></span></footer></main>;
}

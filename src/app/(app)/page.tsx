import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Layers,
  PackagePlus,
  Receipt,
  ShieldAlert,
  ShoppingBag,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  Warehouse,
  Building2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, KpiCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ARABIC_LABELS, CURRENCY, formatDateTime, formatInt, formatMoney } from "@/lib/utils";
import {
  getDashboardMetrics,
  getRecentInvoices,
  getSalesTrend,
  getTopSellingParts,
} from "@/server/services/dashboard.service";
import { getCompanyProfile } from "@/server/services/settings.service";

export const metadata = { title: "لوحة القيادة" };
// Cockpit numbers must reflect the last committed transaction, never a cache.
export const dynamic = "force-dynamic";

const QUICK_ACTIONS = [
  {
    href: "/pos",
    title: "فاتورة بيع (F2)",
    subtitle: "كاشير ونقاط البيع",
    icon: Receipt,
    tone: "bg-bmw-blue/10 text-bmw-blue group-hover:bg-bmw-blue",
    border: "hover:border-bmw-blue",
  },
  {
    href: "/inventory?new=1",
    title: "إدخال صنف (F3)",
    subtitle: "ربط الشاسيه والمحرك",
    icon: PackagePlus,
    tone: "bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500",
    border: "hover:border-emerald-500",
  },
  {
    href: "/treasury?voucher=RECEIPT",
    title: "سند قبض",
    subtitle: "تحصيل من ورشة / عميل",
    icon: ArrowDownLeft,
    tone: "bg-amber-500/10 text-amber-400 group-hover:bg-amber-500",
    border: "hover:border-amber-500",
  },
  {
    href: "/treasury?voucher=PAYMENT",
    title: "سند صرف",
    subtitle: "سداد مورد أو مصروف",
    icon: ArrowUpRight,
    tone: "bg-bmw-mRed/10 text-bmw-mRed group-hover:bg-bmw-mRed",
    border: "hover:border-bmw-mRed",
  },
  {
    href: "/inventory?purchase=1",
    title: "فاتورة شراء",
    subtitle: "استلام شحنة واردة",
    icon: ShoppingBag,
    tone: "bg-purple-500/10 text-purple-400 group-hover:bg-purple-500",
    border: "hover:border-purple-500",
  },
  {
    href: "/settings",
    title: "الإعدادات",
    subtitle: "تخصيص الحقول والنسخ",
    icon: SlidersHorizontal,
    tone: "bg-gray-500/10 text-gray-400 group-hover:bg-gray-500",
    border: "hover:border-gray-500",
  },
] as const;

const CHASSIS_QUICK = ["E36", "E46", "E90", "F30", "G20", "E39", "E60", "F10", "G30"] as const;

export default async function DashboardCockpit() {
  const [metrics, recent, trend, topParts, company] = await Promise.all([
    getDashboardMetrics(),
    getRecentInvoices(8),
    getSalesTrend(7),
    getTopSellingParts(5),
    getCompanyProfile(),
  ]);

  const peak = Math.max(...trend.map((t) => t.total), 1);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-bmw-cardBorder bg-bmw-carbon/60 p-4"><div className="flex items-center gap-3">{company.logoUrl ? <img src={company.logoUrl} alt={`شعار ${company.name}`} className="h-12 w-auto max-w-24 rounded-lg border border-bmw-cardBorder bg-white object-contain p-1" /> : <div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-3 text-bmw-blue"><Building2 size={24} /></div>}<div><h1 className="text-lg font-bold text-white">{company.name}</h1><p className="text-xs text-bmw-muted">{company.commercialName || "لوحة القيادة التشغيلية"}</p></div></div><p className="text-xs text-bmw-muted">مؤشرات المخزون والمبيعات والسيولة المباشرة</p></header>
      {/* KPI performance counters */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="مبيعات اليوم (Live Cockpit)"
          value={formatMoney(metrics.salesToday)}
          unit={CURRENCY}
          accent="blue"
          hint={
            metrics.salesDeltaPercent === null ? (
              <span>{formatInt(metrics.invoiceCountToday)} فاتورة اليوم</span>
            ) : (
              <span
                className={
                  metrics.salesDeltaPercent >= 0
                    ? "flex items-center gap-1 font-mono text-emerald-400"
                    : "flex items-center gap-1 font-mono text-bmw-mRed"
                }
              >
                {metrics.salesDeltaPercent >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {metrics.salesDeltaPercent >= 0 ? "+" : ""}
                {metrics.salesDeltaPercent.toFixed(1)}% مقارنة بالأمس
              </span>
            )
          }
        />
        <KpiCard
          label="السيولة في درج النقدية"
          value={formatMoney(metrics.cashOnHand)}
          unit={CURRENCY}
          accent="green"
          hint={
            metrics.openShift ? (
              <span>
                وردية <span className="font-mono">{metrics.openShift.shiftNumber}</span> مفتوحة —{" "}
                {metrics.openShift.treasuryName}
              </span>
            ) : (
              <span className="text-amber-400/90">لا توجد وردية مفتوحة</span>
            )
          }
        />
        <KpiCard
          label="مديونيات العملاء والورش"
          value={formatMoney(metrics.workshopReceivables)}
          unit={CURRENCY}
          accent="yellow"
          hint={
            metrics.overdueWorkshopCount > 0 ? (
              <span className="text-amber-500/90">
                {formatInt(metrics.overdueWorkshopCount)} مركز صيانة متجاوز للأجل (+٣٠ يوم)
              </span>
            ) : (
              <span>لا توجد مديونيات متأخرة</span>
            )
          }
        />
        <KpiCard
          label="نواقص المستودع الحرجة"
          value={formatInt(metrics.lowStockCount)}
          unit="صنف"
          accent="red"
          hint={
            metrics.lowStockCount > 0 ? (
              <Link
                href="/inventory?lowStock=1"
                className="flex items-center gap-1 text-bmw-mRed/90 hover:underline"
              >
                <ShieldAlert size={12} /> تتطلب إصدار طلب شراء فوري
              </Link>
            ) : (
              <span>كل الأصناف فوق حد الطلب</span>
            )
          }
        />
      </div>

      {/* Secondary financial row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="إجمالي السيولة (كل الخزائن)" value={formatMoney(metrics.totalLiquidity)} unit={CURRENCY} accent="blue" />
        <KpiCard label="ربح اليوم المُجمّع" value={formatMoney(metrics.grossProfitToday)} unit={CURRENCY} accent="green" />
        <KpiCard label="مستحقات الموردين" value={formatMoney(metrics.supplierPayables)} unit={CURRENCY} accent="purple" />
        <KpiCard
          label="قيمة المخزون بالتكلفة"
          value={formatMoney(metrics.inventoryValue)}
          unit={CURRENCY}
          accent="blue"
          icon={<Warehouse size={14} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Operational hub */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
              <Layers className="text-bmw-blue" size={18} /> العمليات التشغيلية المباشرة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.title}
                    href={action.href}
                    className={`group flex flex-col items-center justify-center gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-4 text-center transition-all ${action.border}`}
                  >
                    <div className={`rounded-lg p-3 transition-all group-hover:text-white ${action.tone}`}>
                      <Icon size={22} />
                    </div>
                    <span className="text-sm font-bold text-white">{action.title}</span>
                    <span className="text-[10px] text-bmw-muted">{action.subtitle}</span>
                  </Link>
                );
              })}
            </div>

            {/* 7-day sales trend */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">مبيعات آخر ٧ أيام</h3>
                <span className="font-mono text-[10px] text-bmw-muted">
                  الذروة: {formatMoney(peak)} {CURRENCY}
                </span>
              </div>
              <div className="flex h-32 items-end justify-between gap-2" dir="ltr">
                {trend.map((point) => {
                  const height = Math.max(4, (point.total / peak) * 100);
                  const day = new Date(point.date);
                  return (
                    <div key={point.date} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="font-mono text-[9px] text-bmw-muted">
                        {point.total > 0 ? Math.round(point.total / 1000) + "k" : ""}
                      </span>
                      <div
                        className="w-full rounded-t bg-gradient-to-t from-bmw-mDarkBlue to-bmw-blue transition-all hover:from-bmw-blue hover:to-bmw-electricBlue"
                        style={{ height: `${height}%` }}
                        title={`${formatMoney(point.total)} ${CURRENCY}`}
                      />
                      <span className="font-mono text-[9px] text-bmw-muted">
                        {day.getDate()}/{day.getMonth() + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fitment quick selector */}
        <Card>
          <CardHeader>
            <CardTitle>استعلام التوافق الفوري</CardTitle>
            <span className="font-mono text-xs text-bmw-blue">Fitment Matrix</span>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-bmw-muted">حدد الشاسيه للتحقق من المخزون المتوافق فوراً:</p>
            <div className="grid grid-cols-3 gap-2 font-mono text-xs">
              {CHASSIS_QUICK.map((chassis) => (
                <Link
                  key={chassis}
                  href={`/inventory?chassis=${chassis}`}
                  className="rounded-lg border border-bmw-cardBorder bg-bmw-carbon p-2.5 text-center font-bold text-gray-300 transition-all hover:border-bmw-blue hover:text-white"
                >
                  {chassis}
                </Link>
              ))}
            </div>

            <div className="border-t border-bmw-cardBorder pt-4">
              <h3 className="mb-3 text-sm font-bold text-white">الأكثر حركة (٣٠ يوم)</h3>
              {topParts.length === 0 ? (
                <p className="text-xs text-bmw-muted">لا توجد مبيعات مسجلة بعد.</p>
              ) : (
                <ul className="space-y-2">
                  {topParts.map((part) => (
                    <li key={part.partId} className="flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-bmw-silver">{part.nameAr}</p>
                        <p className="font-mono text-[10px] text-bmw-muted">{part.oemNumber}</p>
                      </div>
                      <Badge variant="blue" mono>
                        {formatInt(part.soldQuantity)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent documents */}
      <Card>
        <CardHeader>
          <CardTitle>
            <Receipt className="text-bmw-blue" size={18} /> آخر الفواتير
          </CardTitle>
          <Link href="/pos" className="text-xs text-bmw-blue hover:underline">
            فاتورة جديدة
          </Link>
        </CardHeader>
        <Table>
          <THead>
            <TR>
              <TH>رقم الفاتورة</TH>
              <TH>النوع</TH>
              <TH>الحساب</TH>
              <TH>الأصناف</TH>
              <TH>الإجمالي</TH>
              <TH>الحالة</TH>
              <TH>الكاشير</TH>
              <TH>التاريخ</TH>
            </TR>
          </THead>
          <TBody>
            {recent.length === 0 ? (
              <EmptyState
                colSpan={8}
                title="لا توجد فواتير بعد"
                description="ابدأ أول عملية بيع من نقطة البيع (F2)."
                icon={<Receipt size={32} />}
              />
            ) : (
              recent.map((invoice) => (
                <TR key={invoice.id} className={invoice.isVoided ? "opacity-50" : undefined}>
                  <TD className="tabular font-bold text-white">{invoice.invoiceNumber}</TD>
                  <TD>
                    <Badge variant={invoice.type === "SALE" ? "blue" : "purple"}>
                      {ARABIC_LABELS.invoiceType[invoice.type]}
                    </Badge>
                  </TD>
                  <TD className="max-w-[200px] truncate">{invoice.accountName}</TD>
                  <TD className="tabular text-bmw-muted">{formatInt(invoice.itemCount)}</TD>
                  <TD className="tabular font-bold">{formatMoney(invoice.grandTotal)}</TD>
                  <TD>
                    {invoice.isVoided ? (
                      <Badge variant="danger">ملغاة</Badge>
                    ) : (
                      <Badge
                        variant={
                          invoice.paymentStatus === "PAID"
                            ? "success"
                            : invoice.paymentStatus === "PARTIAL"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {ARABIC_LABELS.paymentStatus[invoice.paymentStatus]}
                      </Badge>
                    )}
                  </TD>
                  <TD className="text-xs text-bmw-muted">{invoice.userName}</TD>
                  <TD className="tabular text-xs text-bmw-muted">{formatDateTime(invoice.createdAt)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

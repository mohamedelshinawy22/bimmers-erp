import { AlertTriangle, Calendar, Clock, KeyRound, ShieldCheck } from "lucide-react";
import type { SubscriptionDetails } from "@/lib/license-subscription";

export function LicenseSubscriptionCard({ subscription }: { subscription: SubscriptionDetails }) {
  const isWarning = Boolean(subscription.hasAuthoritativeTimeline && subscription.daysRemaining <= 30 && !subscription.isExpired);
  const tone = subscription.isExpired ? "rose" : isWarning ? "amber" : subscription.hasAuthoritativeTimeline ? "emerald" : "slate";
  const badgeClass = tone === "rose" ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : tone === "amber" ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : tone === "emerald" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-slate-500/30 bg-slate-500/10 text-slate-300";
  const barClass = tone === "rose" ? "bg-rose-500" : tone === "amber" ? "bg-amber-500" : tone === "emerald" ? "bg-gradient-to-l from-bmw-blue to-emerald-500" : "bg-slate-500";

  return (
    <section className="overflow-hidden rounded-xl border border-bmw-cardBorder bg-bmw-carbon/65 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-bmw-cardBorder px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue"><ShieldCheck size={20} /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-bold text-white">بيانات ترخيص واشتراك النظام</h2><span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${badgeClass}`}>{subscription.statusText}</span></div>
            <p className="mt-1 text-xs text-bmw-muted">{subscription.planName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-bmw-cardBorder bg-bmw-black/55 px-3 py-2 text-xs text-bmw-muted"><KeyRound size={14} className="text-bmw-silver" /><span>مرجع الترخيص:</span><span className="font-mono tracking-wider text-bmw-silver" dir="ltr">{subscription.licenseKeyDisplay}</span></div>
      </div>

      <div className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-3">
        <SubscriptionStat icon={<Calendar size={17} />} label="تاريخ تفعيل النظام" value={subscription.startDate} />
        <SubscriptionStat icon={<Calendar size={17} />} label="تاريخ انتهاء الترخيص" value={subscription.expiryDate} accent="text-rose-300" />
        <SubscriptionStat icon={subscription.isExpired || isWarning ? <AlertTriangle size={17} /> : <Clock size={17} />} label="باقي على انتهاء الاشتراك" value={!subscription.hasAuthoritativeTimeline ? "لا تتوفر مدة كاملة" : subscription.isExpired ? "الاشتراك منتهي" : `${subscription.daysRemaining} يوم متبقي`} accent={tone === "rose" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : tone === "emerald" ? "text-emerald-300" : "text-slate-300"} />
      </div>

      <div className="border-t border-bmw-cardBorder px-5 py-4">
        <div className="mb-2 flex items-center justify-between text-xs text-bmw-muted"><span>المدة المستهلكة من الترخيص</span><span className="font-mono text-bmw-silver">{subscription.hasAuthoritativeTimeline ? `${subscription.progressPercentage}%` : "غير متاح"}</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-bmw-black/70"><div className={`h-full rounded-full ${barClass}`} style={{ width: `${subscription.progressPercentage}%` }} /></div>
      </div>
    </section>
  );
}

function SubscriptionStat({ icon, label, value, accent = "text-bmw-silver" }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return <div className="flex items-center gap-3 rounded-lg border border-bmw-cardBorder bg-bmw-black/35 p-3.5"><span className={accent}>{icon}</span><div><p className="text-[11px] text-bmw-muted">{label}</p><p className={`mt-0.5 text-sm font-bold ${accent}`}>{value}</p></div></div>;
}

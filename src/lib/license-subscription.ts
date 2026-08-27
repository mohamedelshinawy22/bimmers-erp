export interface TenantSubscriptionRoute {
  licenseKey: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SubscriptionDetails {
  planName: string;
  licenseKeyDisplay: string;
  startDate: string;
  expiryDate: string;
  hasAuthoritativeTimeline: boolean;
  totalDays: number;
  daysRemaining: number;
  isExpired: boolean;
  statusText: string;
  progressPercentage: number;
}

const dayMs = 24 * 60 * 60 * 1000;

function validDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function maskedLicenseKey(value: string): string {
  const key = value.trim();
  if (key.length <= 8) return "••••••••";
  return `••••••••${key.slice(-8)}`;
}

/**
 * Formats license dates from the already-authenticated Master Hub route. It
 * intentionally masks the route license identifier because that identifier is
 * used by server-to-server licensing calls and is not needed in full by staff.
 */
export function getTenantSubscriptionDetails(route: TenantSubscriptionRoute, now = new Date()): SubscriptionDetails {
  const expiry = validDate(route.expiresAt);
  const issued = validDate(route.issuedAt);
  const timelineMs = issued && expiry && issued.getTime() <= expiry.getTime() ? expiry.getTime() - issued.getTime() : null;
  const hasAuthoritativeTimeline = timelineMs !== null;
  const totalDays = timelineMs === null ? 0 : Math.max(1, Math.ceil(timelineMs / dayMs));
  const remainingMs = expiry ? expiry.getTime() - now.getTime() : 0;
  const isExpired = Boolean(expiry && remainingMs <= 0);
  const daysRemaining = !expiry || isExpired ? 0 : Math.ceil(remainingMs / dayMs);
  const consumedDays = hasAuthoritativeTimeline ? Math.max(0, totalDays - daysRemaining) : 0;
  const progressPercentage = !hasAuthoritativeTimeline ? 0 : isExpired ? 100 : Math.min(100, Math.max(0, Math.round((consumedDays / totalDays) * 100)));
  const statusText = !expiry ? "بيانات الترخيص غير متاحة" : isExpired ? "منتهي الصلاحية" : daysRemaining <= 30 ? "يوشك على الانتهاء" : "ساري ونشط";
  const dateFormat = { year: "numeric", month: "long", day: "numeric" } as const;

  return {
    planName: "Bimmers ERP — نسخة سحابية مرخصة",
    licenseKeyDisplay: maskedLicenseKey(route.licenseKey),
    startDate: issued?.toLocaleDateString("ar-EG", dateFormat) ?? "غير متاح",
    expiryDate: expiry?.toLocaleDateString("ar-EG", dateFormat) ?? "غير متاح",
    hasAuthoritativeTimeline,
    totalDays,
    daysRemaining,
    isExpired,
    statusText,
    progressPercentage,
  };
}

import { describe, expect, it } from "vitest";
import { getTenantSubscriptionDetails } from "./license-subscription";

describe("tenant subscription details", () => {
  it("uses authoritative route dates, masks license references, and calculates active progress", () => {
    const details = getTenantSubscriptionDetails({ licenseKey: "LIC-BMR-BAVARIA-2026", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }, new Date("2026-07-01T00:00:00.000Z"));
    expect(details.planName).toContain("Bimmers ERP");
    expect(details.licenseKeyDisplay).toBe("••••••••RIA-2026");
    expect(details.isExpired).toBe(false);
    expect(details.daysRemaining).toBe(184);
    expect(details.progressPercentage).toBeGreaterThan(0);
    expect(details.progressPercentage).toBeLessThan(100);
  });

  it("marks expired routes as expired rather than inventing a replacement license date", () => {
    const details = getTenantSubscriptionDetails({ licenseKey: "LICENSE-12345678", issuedAt: "2025-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-08-01T00:00:00.000Z"));
    expect(details).toMatchObject({ daysRemaining: 0, isExpired: true, statusText: "منتهي الصلاحية", progressPercentage: 100 });
  });

  it("does not invent dates or expose a short license key when route date data is incomplete", () => {
    const details = getTenantSubscriptionDetails({ licenseKey: "short", issuedAt: "not-a-date", expiresAt: "also-not-a-date" }, new Date("2026-08-01T00:00:00.000Z"));
    expect(details).toMatchObject({
      licenseKeyDisplay: "••••••••",
      startDate: "غير متاح",
      expiryDate: "غير متاح",
      hasAuthoritativeTimeline: false,
      daysRemaining: 0,
      progressPercentage: 0,
      statusText: "بيانات الترخيص غير متاحة",
    });
  });
});

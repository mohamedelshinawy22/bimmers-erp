import { redirect } from "next/navigation";
import { AuthError, requireUser, withAuthenticatedTenant } from "@/lib/auth";
import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { MStripe } from "@/components/layout/m-stripe";
import { HotkeysListener } from "@/components/layout/hotkeys-listener";
import { SidebarProvider } from "@/components/layout/sidebar-context";
import { getCompanyProfile } from "@/server/services/settings.service";
import { CopilotFloatingWidget } from "@/components/ai/copilot-floating-widget";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Authenticated shell.
 *
 * Uses `requireUser()` (DB-backed) rather than `getSession()` (cookie-signature
 * only). A signed cookie stays cryptographically valid until it expires, so a
 * cookie-only check let a user who had just been deactivated keep reading pages
 * for up to SESSION_TTL_HOURS. Verifying `isActive` here means deactivation
 * takes effect on the next request, and any page added under this group inherits
 * that guarantee instead of having to remember its own check.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    // Bare `/login` — NO `next` param, deliberately.
    //
    // The middleware already captured the intended destination (and sanitised it
    // via src/lib/safe-redirect.ts) before this layout ever ran, so appending one
    // here would be redundant. It would also be dangerous: a Server Component
    // cannot set cookies in Next 14, so this branch has no way to clear the stale
    // cookie that sent it here. Handing back a `next` would just re-feed the
    // /login ↔ / redirect loop from the layout side. Emit the plainest possible
    // target and let the middleware, which CAN delete the cookie, resolve it.
    if (error instanceof AuthError) redirect("/login");
    throw error;
  }

  const company = await withAuthenticatedTenant(async () => {
    try {
      return await getCompanyProfile();
    } catch (error) {
      console.error("[app-layout] company-profile fallback:", error);
      return {
        name: "BimmerERP",
        commercialName: "",
        phone: "",
        phonePrimary: "",
        phoneSecondary: "",
        address: "",
        taxNumber: "",
        commercialRegister: "",
        logoUrl: "",
        invoiceFooter: "",
      };
    }
  });
  const branding = { name: company.name, logoUrl: company.logoUrl };
  return (
    <SidebarProvider>
      <div className="flex min-h-screen" dir="rtl">
        <HotkeysListener />
        <Sidebar role={user.role} branding={branding} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MStripe className="no-print" />
          <Header user={user} branding={branding} />
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
          <CopilotFloatingWidget />
        </div>
      </div>
    </SidebarProvider>
  );
}

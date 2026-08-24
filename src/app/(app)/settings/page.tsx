import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { getCompanyProfile, getSettingsGrouped } from "@/server/services/settings.service";
import { listUsers } from "@/server/services/audit.service";
import { getTenantContext } from "@/lib/tenant-routing";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "الإعدادات" };
export const dynamic = "force-dynamic";
export const revalidate = 0;
// Recovery actions are atomic and may replay a complete verified snapshot.
export const maxDuration = 60;

export default async function SettingsPage() {
  const tenant = await getTenantDbFromSession();
  const user = tenant.user;
  return tenant.run(async () => {
  if (!can(user.role, "settings.read")) redirect("/");

  const canManageUsers = can(user.role, "user.manage");
  const [groups, users, companyProfile] = await Promise.all([
    getSettingsGrouped(tenant.prisma),
    canManageUsers ? listUsers(tenant.prisma) : Promise.resolve(null),
    getCompanyProfile(tenant.prisma),
  ]);
  const tenantQuota = canManageUsers && users
    ? {
        maxSubUsers: getTenantContext().route.maxSubUsers,
        activeSubUsers: users.filter((account) => account.isActive && account.role !== "SUPER_ADMIN").length,
      }
    : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Link href="/inventory?import=1" className="flex items-center justify-between rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 px-4 py-3 text-sm font-bold text-bmw-blue hover:bg-bmw-blue/20">استيراد بيانات من إكسيل <span>←</span></Link>
        {can(user.role, "barcode.manage") ? <Link href="/settings/barcode" className="flex items-center justify-between rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-bold text-emerald-200 hover:bg-emerald-400/20">إعدادات طباعة الباركود الحرارية <span>←</span></Link> : null}
      </div>
      <SettingsForm
        groups={groups}
        canWrite={can(user.role, "settings.write")}
        canFactoryReset={can(user.role, "system.maintenance")}
        users={users}
        currentUserId={user.id}
        companyProfile={companyProfile}
        tenantQuota={tenantQuota}
      />
    </div>
  );
  });
}

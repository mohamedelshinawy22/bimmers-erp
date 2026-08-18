import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getCompanyProfile, getSettingsGrouped } from "@/server/services/settings.service";
import { listUsers } from "@/server/services/audit.service";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "الإعدادات" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  if (!can(user.role, "settings.read")) redirect("/");

  const canManageUsers = can(user.role, "user.manage");
  const [groups, users, companyProfile] = await Promise.all([
    getSettingsGrouped(),
    canManageUsers ? listUsers() : Promise.resolve(null),
    getCompanyProfile(),
  ]);

  return (
    <div className="space-y-4">
      <Link href="/inventory?import=1" className="flex items-center justify-between rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 px-4 py-3 text-sm font-bold text-bmw-blue hover:bg-bmw-blue/20">استيراد بيانات من إكسيل <span>←</span></Link>
      <SettingsForm
        groups={groups}
        canWrite={can(user.role, "settings.write")}
        users={users}
        currentUserId={user.id}
        companyProfile={companyProfile}
      />
    </div>
  );
}

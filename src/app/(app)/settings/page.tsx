import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { getSettingsGrouped } from "@/server/services/settings.service";
import { listUsers } from "@/server/services/audit.service";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "الإعدادات" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  if (!can(user.role, "settings.read")) redirect("/");

  const canManageUsers = can(user.role, "user.manage");
  const [groups, users] = await Promise.all([
    getSettingsGrouped(),
    canManageUsers ? listUsers() : Promise.resolve(null),
  ]);

  return (
    <SettingsForm
      groups={groups}
      canWrite={can(user.role, "settings.write")}
      users={users}
      currentUserId={user.id}
    />
  );
}

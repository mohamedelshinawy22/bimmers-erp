"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Car, LogOut, ShieldCheck, UserRound } from "lucide-react";
import type { Role } from "@prisma/client";
import { logoutAction } from "@/server/actions/auth.actions";
import { ARABIC_LABELS } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { HotkeyBadges } from "./hotkeys-listener";

interface HeaderProps {
  user: { fullName: string; username: string; role: Role };
}

export function Header({ user }: HeaderProps) {
  const [pending, startTransition] = useTransition();

  return (
    <header className="no-print sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-bmw-cardBorder bg-bmw-carbon/80 px-6 py-4 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <Link href="/" className="flex items-center gap-3 lg:hidden">
          <div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2 text-bmw-blue">
            <Car size={22} />
          </div>
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-wide text-white">
            BimmerERP
            <span className="rounded-full bg-bmw-mRed px-2 py-0.5 font-mono text-[10px] font-normal text-white">
              M-POWER OS
            </span>
          </h1>
          <p className="hidden text-xs text-bmw-muted sm:block">
            نظام إدارة المخازن والحسابات المتكامل لقطع غيار BMW الجديدة
          </p>
        </div>
      </div>

      <HotkeyBadges />

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-xl border border-bmw-cardBorder bg-bmw-card px-3 py-1.5 sm:flex">
          <UserRound size={16} className="text-bmw-blue" />
          <div className="leading-tight">
            <p className="text-xs font-bold text-white">{user.fullName}</p>
            <p className="font-mono text-[10px] text-bmw-muted">@{user.username}</p>
          </div>
          <Badge variant={user.role === "SUPER_ADMIN" ? "blue" : "muted"}>
            <ShieldCheck size={11} />
            {ARABIC_LABELS.role[user.role]}
          </Badge>
        </div>

        <form action={() => startTransition(() => void logoutAction())}>
          <button
            type="submit"
            disabled={pending}
            title="تسجيل الخروج"
            className="rounded-xl border border-bmw-cardBorder bg-bmw-card p-2.5 text-bmw-muted transition-colors hover:border-bmw-mRed/50 hover:text-bmw-mRed disabled:opacity-50"
          >
            <LogOut size={16} />
          </button>
        </form>
      </div>
    </header>
  );
}

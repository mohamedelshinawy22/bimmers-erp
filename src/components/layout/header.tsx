"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Car, LogOut, Menu, ShieldCheck, UserRound, X } from "lucide-react";
import type { Role } from "@prisma/client";
import { logoutAction } from "@/server/actions/auth.actions";
import { ARABIC_LABELS } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { HotkeyBadges } from "./hotkeys-listener";
import { useSidebar } from "./sidebar-context";

interface HeaderProps {
  user: { fullName: string; username: string; role: Role };
  branding: { name: string; logoUrl?: string | null };
}

export function Header({ user, branding }: HeaderProps) {
  const [pending, startTransition] = useTransition();
  const { isMobileOpen, toggleMobileSidebar } = useSidebar();

  return (
    <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-bmw-cardBorder bg-bmw-carbon/80 px-4 py-4 backdrop-blur-md sm:px-6">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button type="button" onClick={toggleMobileSidebar} className="rounded-xl border border-bmw-cardBorder bg-bmw-card p-2 text-bmw-muted transition-colors hover:border-bmw-blue/50 hover:text-white lg:hidden" aria-label={isMobileOpen ? "إغلاق القائمة الجانبية" : "فتح القائمة الجانبية"} aria-expanded={isMobileOpen}>
          {isMobileOpen ? <X size={21} className="text-bmw-mRed" /> : <Menu size={21} />}
        </button>
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 text-bmw-blue">{branding.logoUrl ? <img src={branding.logoUrl} alt={`شعار ${branding.name}`} className="h-8 w-auto max-w-10 object-contain" /> : <Car size={22} />}</div>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 truncate text-lg font-bold tracking-wide text-white">
              {branding.name || "BimmerERP"}
              <span className="hidden rounded-full bg-bmw-mRed px-2 py-0.5 font-mono text-[10px] font-normal text-white sm:inline">M-POWER OS</span>
            </h1>
            <p className="hidden text-xs text-bmw-muted sm:block">نظام إدارة المخازن والحسابات المتكامل لقطع غيار BMW الجديدة</p>
          </div>
        </Link>
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

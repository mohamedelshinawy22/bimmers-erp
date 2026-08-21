"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Barcode,
  Boxes,
  Car,
  LayoutDashboard,
  Receipt,
  RotateCcw,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { Role } from "@prisma/client";
import { can, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";

const NAV: Array<{
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  hotkey: string | null;
  permission: Permission | null;
}> = [
  { href: "/", label: "لوحة القيادة", icon: LayoutDashboard, hotkey: null, permission: null },
  { href: "/pos", label: "نقطة البيع", icon: Receipt, hotkey: "F2", permission: "invoice.sale" },
  { href: "/inventory", label: "كتالوج البضاعة", icon: Boxes, hotkey: "F3", permission: "part.read" },
  { href: "/invoices", label: "الفواتير", icon: ScrollText, hotkey: "F6", permission: "invoice.read" },
  { href: "/sales/returns", label: "مرتجع المبيعات", icon: RotateCcw, hotkey: null, permission: "invoice.sale" },
  { href: "/purchases/returns", label: "مرتجع المشتريات", icon: RotateCcw, hotkey: null, permission: "invoice.purchase" },
  { href: "/accounts", label: "الحسابات والورش", icon: Users, hotkey: "F4", permission: "account.read" },
  { href: "/treasury", label: "الخزينة والسيولة", icon: Wallet, hotkey: "F5", permission: "treasury.read" },
  { href: "/vouchers", label: "سجل السندات والتحصيلات", icon: Receipt, hotkey: "F8", permission: "treasury.read" },
  { href: "/reports/daily-movement", label: "تقرير الحركة اليومية", icon: BarChart3, hotkey: null, permission: "reports.dailyMovement" },
  { href: "/reports/inventory-movement", label: "حركة البضاعة والرواكد", icon: BarChart3, hotkey: null, permission: "reports.dailyMovement" },
  { href: "/audit", label: "سجل التدقيق", icon: ShieldCheck, hotkey: null, permission: "audit.read" },
  { href: "/users", label: "المستخدمون والصلاحيات", icon: ShieldCheck, hotkey: null, permission: "user.manage" },
  { href: "/settings", label: "الإعدادات", icon: SlidersHorizontal, hotkey: null, permission: "settings.read" },
  { href: "/settings/barcode", label: "طباعة الباركود الحرارية", icon: Barcode, hotkey: null, permission: "barcode.manage" },
];

export function Sidebar({ role, branding }: { role: Role; branding: { name: string; logoUrl?: string | null } }) {
  const pathname = usePathname();
  const { isMobileOpen, closeMobileSidebar } = useSidebar();
  const items = NAV.filter((item) => item.permission === null || can(role, item.permission));

  return (
    <>
      <button
        type="button"
        aria-label="إغلاق القائمة الجانبية"
        aria-hidden={!isMobileOpen}
        tabIndex={isMobileOpen ? 0 : -1}
        onClick={closeMobileSidebar}
        className={cn(
          "no-print fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          isMobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        aria-label="القائمة الرئيسية"
        className={cn(
          "no-print fixed inset-y-0 right-0 z-50 flex h-dvh w-72 max-w-[86vw] flex-col border-l border-bmw-cardBorder bg-bmw-carbon shadow-2xl transition-transform duration-300 ease-out lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:shadow-none",
          isMobileOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-bmw-cardBorder px-5 py-[17px]">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 text-bmw-blue">
              {branding.logoUrl ? <img src={branding.logoUrl} alt={`شعار ${branding.name}`} className="h-9 w-auto max-w-11 object-contain" /> : <Car size={22} />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-wide text-white">{branding.name || "BimmerERP"}</p>
              <p className="font-mono text-[10px] text-bmw-muted">M-POWER OS</p>
            </div>
          </div>
          <button type="button" onClick={closeMobileSidebar} className="rounded-lg p-2 text-bmw-muted transition-colors hover:bg-bmw-card hover:text-white lg:hidden" aria-label="إغلاق القائمة">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobileSidebar}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                  active ? "bg-bmw-blue/10 font-bold text-white" : "text-bmw-muted hover:bg-bmw-card hover:text-white",
                )}
              >
                {active ? <span className="absolute right-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-bmw-blue" /> : null}
                <Icon size={18} className={active ? "text-bmw-blue" : ""} />
                <span className="flex-1">{item.label}</span>
                {item.hotkey ? <span className="rounded border border-bmw-cardBorder px-1.5 font-mono text-[10px] text-bmw-muted">{item.hotkey}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-bmw-cardBorder p-4">
          <p className="text-[10px] leading-relaxed text-bmw-muted">نظام إدارة مخازن وحسابات قطع غيار BMW الجديدة.<br /><span className="font-mono">Row Locks • Audit Trail • WAL Archiving</span></p>
        </div>
      </aside>
    </>
  );
}

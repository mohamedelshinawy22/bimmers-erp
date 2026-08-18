"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export const HOTKEYS = [
  { key: "F2", href: "/pos", label: "نقطة البيع" },
  { key: "F3", href: "/accounts", label: "الحسابات والورش" },
  { key: "F4", href: "/inventory", label: "كتالوج البضاعة" },
  { key: "F5", href: "/treasury", label: "الخزينة والسيولة" },
] as const;

/**
 * Global function-key navigation.
 *
 * Uses the App Router (client-side navigation) instead of window.location so we
 * keep the React tree and don't blow away in-progress POS state on a full reload.
 * Hotkeys are suppressed while a modal is open or a field is focused so F5 in a
 * text input can still be typed/handled by the page itself.
 */
export function HotkeysListener() {
  const router = useRouter();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "F6" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('[role="dialog"]')) {
          event.preventDefault();
          window.dispatchEvent(new CustomEvent("bimmererp:quick-voucher"));
        }
        return;
      }
      const match = HOTKEYS.find((h) => h.key === event.key);
      if (!match) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"]')) return;

      event.preventDefault();
      router.push(match.href);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router]);

  return null;
}

export function HotkeyBadges() {
  return (
    <div className="hidden items-center gap-2 lg:flex">
      {HOTKEYS.map((h) => (
        <span
          key={h.key}
          className="rounded-lg border border-bmw-cardBorder bg-bmw-card px-3 py-1.5 font-mono text-xs text-gray-300"
        >
          <strong className="font-bold text-bmw-blue">{h.key}</strong> {h.label}
        </span>
      ))}
    </div>
  );
}

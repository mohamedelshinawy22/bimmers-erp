"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";

interface BackButtonProps {
  fallbackUrl?: string;
  label?: string;
  className?: string;
}

export function BackButton({ fallbackUrl = "/", label = "رجوع", className = "" }: BackButtonProps) {
  const router = useRouter();
  const handleBack = () => {
    if (typeof window === "undefined") { router.push(fallbackUrl); return; }
    const referrerIsInternal = !document.referrer || new URL(document.referrer).origin === window.location.origin;
    if (window.history.length > 1 && referrerIsInternal) router.back();
    else router.push(fallbackUrl);
  };

  return <button type="button" onClick={handleBack} className={`inline-flex items-center gap-1.5 rounded-xl border border-bmw-cardBorder bg-bmw-card px-3 py-2 text-xs font-medium text-bmw-muted shadow-sm transition-all hover:border-bmw-blue/50 hover:bg-bmw-blue/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-bmw-blue/50 ${className}`} title="الرجوع للصفحة السابقة"><ArrowRight size={16} /><span>{label}</span></button>;
}

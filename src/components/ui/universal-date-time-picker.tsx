"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Pin, RotateCcw } from "lucide-react";
import { Button } from "./button";
import { Input } from "./input";

export type DatePreset = "TODAY" | "YESTERDAY" | "THIS_WEEK" | "THIS_MONTH" | "PREVIOUS_MONTH" | "CUSTOM";
export interface DateRangeValue { from: string; to: string; preset: DatePreset; pinned: boolean; }
export interface UniversalDateTimePickerProps { value?: DateRangeValue; onChange: (value: DateRangeValue) => void; syncToUrl?: boolean; storageKey?: string; }

function isoLocal(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function rangeFor(preset: DatePreset): Pick<DateRangeValue, "from" | "to"> {
  const now = new Date(); const start = new Date(now); const end = new Date(now);
  if (preset === "YESTERDAY") { start.setDate(now.getDate() - 1); end.setDate(now.getDate() - 1); }
  if (preset === "THIS_WEEK") start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  if (preset === "THIS_MONTH") start.setDate(1);
  if (preset === "PREVIOUS_MONTH") { start.setMonth(now.getMonth() - 1, 1); end.setDate(0); }
  start.setHours(0, 0, 0, 0); end.setHours(23, 59, 0, 0); return { from: isoLocal(start), to: isoLocal(end) };
}
function defaultValue(): DateRangeValue { return { ...rangeFor("TODAY"), preset: "TODAY", pinned: false }; }
function isPreset(value: string | null): value is DatePreset { return ["TODAY", "YESTERDAY", "THIS_WEEK", "THIS_MONTH", "PREVIOUS_MONTH", "CUSTOM"].includes(value ?? ""); }

export function UniversalDateTimePicker({ value, onChange, syncToUrl = false, storageKey = "bimmererp:date-range" }: UniversalDateTimePickerProps) {
  const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams();
  const urlValue = useMemo<DateRangeValue | null>(() => { if (!syncToUrl) return null; const from = searchParams.get("from"), to = searchParams.get("to"), preset = searchParams.get("preset"); return from && to && isPreset(preset) ? { from, to, preset, pinned: searchParams.get("pinned") === "1" } : null; }, [searchParams, syncToUrl]);
  const initial = useMemo(() => urlValue ?? value ?? defaultValue(), [urlValue, value]);
  const [state, setState] = useState<DateRangeValue>(initial);
  useEffect(() => { setState(initial); }, [initial]);
  useEffect(() => { if (!syncToUrl || typeof window === "undefined") return; const saved = window.localStorage.getItem(storageKey); if (!urlValue && saved) { try { const parsed = JSON.parse(saved) as DateRangeValue; if (parsed.pinned) { setState(parsed); onChange(parsed); } } catch { window.localStorage.removeItem(storageKey); } } }, [onChange, storageKey, syncToUrl, urlValue]);
  const commit = (next: DateRangeValue) => { setState(next); onChange(next); if (typeof window !== "undefined") { if (next.pinned) window.localStorage.setItem(storageKey, JSON.stringify(next)); else window.localStorage.removeItem(storageKey); } if (syncToUrl) { const params = new URLSearchParams(searchParams.toString()); params.set("from", next.from); params.set("to", next.to); params.set("preset", next.preset); next.pinned ? params.set("pinned", "1") : params.delete("pinned"); router.replace(`${pathname}?${params.toString()}`, { scroll: false }); } };
  return <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-bmw-cardBorder bg-bmw-card p-3" dir="rtl">
    <label className="grid gap-1 text-xs text-bmw-muted"><span>الفترة</span><select value={state.preset} className="rounded-lg border border-bmw-cardBorder bg-bmw-black px-2 py-2 text-sm text-white" onChange={(event) => { const preset = event.target.value as DatePreset; const range = preset === "CUSTOM" ? { from: state.from, to: state.to } : rangeFor(preset); commit({ ...state, ...range, preset }); }}><option value="TODAY">اليوم</option><option value="YESTERDAY">الأمس</option><option value="THIS_WEEK">هذا الأسبوع</option><option value="THIS_MONTH">هذا الشهر</option><option value="PREVIOUS_MONTH">الشهر السابق</option><option value="CUSTOM">مخصص</option></select></label>
    <label className="grid gap-1 text-xs text-bmw-muted"><span>من</span><Input type="datetime-local" value={state.from} onChange={(e) => commit({ ...state, from: e.target.value, preset: "CUSTOM" })} /></label>
    <label className="grid gap-1 text-xs text-bmw-muted"><span>إلى</span><Input type="datetime-local" value={state.to} onChange={(e) => commit({ ...state, to: e.target.value, preset: "CUSTOM" })} /></label>
    <Button type="button" variant="ghost" size="icon" aria-label="إعادة الضبط" onClick={() => commit({ ...defaultValue(), pinned: false })}><RotateCcw size={16}/></Button>
    <Button type="button" variant={state.pinned ? "primary" : "ghost"} size="icon" aria-label="تثبيت الفترة" onClick={() => commit({ ...state, pinned: !state.pinned })}><Pin size={16}/></Button><CalendarDays className="text-bmw-blue" size={20}/>
  </div>;
}

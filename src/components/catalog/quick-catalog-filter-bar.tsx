"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

export type QuickCatalogFilterState = {
  chassis: string;
  brandId: string;
  inStockOnly: boolean;
};

export type QuickCatalogBrand = { id: string; name: string };

const MODEL_FILTERS = [
  { label: "الكل", value: "" },
  { label: "F30", value: "F30" },
  { label: "F10", value: "F10" },
  { label: "E90", value: "E90" },
  { label: "E60", value: "E60" },
  { label: "X5", value: "E70,F15,G05" },
  { label: "X3", value: "F25,G01" },
  { label: "G30", value: "G30" },
  { label: "MINI", value: "MINI" },
  { label: "G20", value: "G20" },
] as const;

export function QuickCatalogFilterBar({
  value,
  brands,
  onChange,
  onClear,
}: {
  value: QuickCatalogFilterState;
  brands: QuickCatalogBrand[];
  onChange: (next: QuickCatalogFilterState) => void;
  onClear: () => void;
}) {
  const hasFilters = Boolean(value.chassis || value.brandId || value.inStockOnly);
  return (
    <div className="space-y-2 rounded-xl border border-bmw-cardBorder bg-bmw-black/30 p-3" aria-label="فلاتر الكتالوج السريعة">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="ml-1 text-xs font-bold text-bmw-silver">الموديل:</span>
        {MODEL_FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            aria-pressed={value.chassis === filter.value}
            onClick={() => onChange({ ...value, chassis: filter.value })}
            className={`rounded-lg border px-2.5 py-1 text-xs font-mono transition-colors ${value.chassis === filter.value ? "border-bmw-blue/60 bg-bmw-blue/15 text-bmw-blue" : "border-bmw-cardBorder text-bmw-muted hover:border-bmw-blue/40 hover:text-bmw-silver"}`}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="تصفية حسب الماركة" className="h-8 min-w-36 text-xs" value={value.brandId} onChange={(event) => onChange({ ...value, brandId: event.target.value })}>
          <option value="">كل الماركات</option>
          {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
        </Select>
        <button
          type="button"
          aria-pressed={value.inStockOnly}
          onClick={() => onChange({ ...value, inStockOnly: !value.inStockOnly })}
          className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${value.inStockOnly ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-300" : "border-bmw-cardBorder text-bmw-muted hover:border-emerald-400/40 hover:text-bmw-silver"}`}
        >
          المتوفر بالمخزن فقط
        </button>
        {hasFilters ? <Button size="sm" variant="ghost" onClick={onClear}><RotateCcw size={13} /> مسح الفلاتر</Button> : null}
      </div>
    </div>
  );
}

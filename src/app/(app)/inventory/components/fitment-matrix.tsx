"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ChassisOption {
  id: string;
  code: string;
  series: string;
}

export interface EngineOption {
  id: string;
  code: string;
  displacement: string | null;
}

interface FitmentMatrixProps {
  chassis: ChassisOption[];
  engines: EngineOption[];
  selectedChassisIds: string[];
  selectedEngineIds: string[];
  onChangeChassis: (ids: string[]) => void;
  onChangeEngines: (ids: string[]) => void;
}

/**
 * Fitment matrix: chassis grouped by series, engines as a flat grid.
 * This is the compatibility map a counter clerk needs to answer
 * "هل تركب على E46؟" without opening RealOEM.
 */
export function FitmentMatrix({
  chassis,
  engines,
  selectedChassisIds,
  selectedEngineIds,
  onChangeChassis,
  onChangeEngines,
}: FitmentMatrixProps) {
  const [filter, setFilter] = useState("");

  const grouped = useMemo(() => {
    const term = filter.trim().toUpperCase();
    const map = new Map<string, ChassisOption[]>();
    for (const c of chassis) {
      if (term && !c.code.includes(term) && !c.series.toUpperCase().includes(term)) continue;
      const bucket = map.get(c.series) ?? [];
      bucket.push(c);
      map.set(c.series, bucket);
    }
    return [...map.entries()];
  }, [chassis, filter]);

  const filteredEngines = useMemo(() => {
    const term = filter.trim().toUpperCase();
    if (!term) return engines;
    return engines.filter((e) => e.code.includes(term));
  }, [engines, filter]);

  const toggle = (ids: string[], id: string, onChange: (next: string[]) => void) => {
    onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };

  const toggleSeries = (series: ChassisOption[]) => {
    const ids = series.map((s) => s.id);
    const allSelected = ids.every((id) => selectedChassisIds.includes(id));
    onChangeChassis(
      allSelected
        ? selectedChassisIds.filter((id) => !ids.includes(id))
        : [...new Set([...selectedChassisIds, ...ids])],
    );
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="فلترة أكواد الشاسيه أو المحرك… (E46, B48, X5)"
          className="h-9 pr-9 text-xs"
        />
        {filter ? (
          <button
            type="button"
            onClick={() => setFilter("")}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-bmw-muted hover:text-white"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold text-bmw-silver">أكواد الشاسيه المتوافقة</p>
          <Badge variant={selectedChassisIds.length ? "blue" : "muted"} mono>
            {selectedChassisIds.length}
          </Badge>
        </div>
        <div className="max-h-56 space-y-3 overflow-y-auto rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3">
          {grouped.length === 0 ? (
            <p className="py-4 text-center text-xs text-bmw-muted">لا توجد نتائج مطابقة.</p>
          ) : (
            grouped.map(([series, items]) => (
              <div key={series}>
                <button
                  type="button"
                  onClick={() => toggleSeries(items)}
                  className="mb-1.5 text-[11px] font-bold text-bmw-blue hover:underline"
                >
                  {series} ({items.length})
                </button>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((c) => {
                    const active = selectedChassisIds.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggle(selectedChassisIds, c.id, onChangeChassis)}
                        className={cn(
                          "rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition-all",
                          active
                            ? "border-bmw-blue bg-bmw-blue text-white"
                            : "border-bmw-cardBorder bg-bmw-card text-bmw-muted hover:border-bmw-blue hover:text-white",
                        )}
                      >
                        {c.code}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold text-bmw-silver">أكواد المحركات المتوافقة</p>
          <Badge variant={selectedEngineIds.length ? "blue" : "muted"} mono>
            {selectedEngineIds.length}
          </Badge>
        </div>
        <div className="max-h-40 overflow-y-auto rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3">
          {filteredEngines.length === 0 ? (
            <p className="py-4 text-center text-xs text-bmw-muted">لا توجد نتائج مطابقة.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {filteredEngines.map((e) => {
                const active = selectedEngineIds.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    title={e.displacement ?? undefined}
                    onClick={() => toggle(selectedEngineIds, e.id, onChangeEngines)}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold transition-all",
                      active
                        ? "border-emerald-500 bg-emerald-600 text-white"
                        : "border-bmw-cardBorder bg-bmw-card text-bmw-muted hover:border-emerald-500 hover:text-white",
                    )}
                  >
                    {e.code}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

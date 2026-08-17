"use client";

import { useMemo, useState, useTransition } from "react";
import { MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/modal";
import { createBinAction } from "@/server/actions/parts.actions";
import { cn } from "@/lib/utils";

export interface BinOption {
  id: string;
  fullCode: string;
}

interface BinLocatorProps {
  bins: BinOption[];
  value: string;
  onChange: (binId: string) => void;
  canCreate?: boolean;
}

/**
 * Warehouse bin picker: الممر → الحامل → الرف → الصندوق.
 * Codes are stored as `AISLE-RACK-SHELF-BOX`, so we parse them back into the
 * four cascading dropdowns the storekeeper actually thinks in.
 */
export function BinLocator({ bins, value, onChange, canCreate = false }: BinLocatorProps) {
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ aisle: "", rack: "", shelf: "", boxBin: "" });
  const [localBins, setLocalBins] = useState(bins);

  const parsed = useMemo(
    () =>
      localBins.map((b) => {
        const [aisle = "", rack = "", shelf = "", boxBin = ""] = b.fullCode.split("-");
        return { ...b, aisle, rack, shelf, boxBin };
      }),
    [localBins],
  );

  const selected = parsed.find((b) => b.id === value);
  const [aisle, setAisle] = useState(selected?.aisle ?? "");
  const [rack, setRack] = useState(selected?.rack ?? "");
  const [shelf, setShelf] = useState(selected?.shelf ?? "");

  const uniq = (values: string[]) => [...new Set(values)].sort();
  const aisles = uniq(parsed.map((b) => b.aisle));
  const racks = uniq(parsed.filter((b) => b.aisle === aisle).map((b) => b.rack));
  const shelves = uniq(parsed.filter((b) => b.aisle === aisle && b.rack === rack).map((b) => b.shelf));
  const boxes = parsed.filter((b) => b.aisle === aisle && b.rack === rack && b.shelf === shelf);

  const submitNewBin = () => {
    setError(null);
    startTransition(async () => {
      const result = await createBinAction({
        warehouseName: "المستودع الرئيسي",
        aisle: draft.aisle,
        rack: draft.rack,
        shelf: draft.shelf,
        boxBin: draft.boxBin,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setLocalBins((current) => [...current, { id: result.data.id, fullCode: result.data.fullCode }]);
      onChange(result.data.id);
      const [a = "", r = "", s = ""] = result.data.fullCode.split("-");
      setAisle(a);
      setRack(r);
      setShelf(s);
      setCreating(false);
      setDraft({ aisle: "", rack: "", shelf: "", boxBin: "" });
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-bold text-bmw-silver">
          <MapPin size={13} className="text-bmw-blue" /> موقع التخزين في المستودع
        </p>
        {selected ? (
          <span className="rounded-lg border border-bmw-blue/40 bg-bmw-blue/10 px-2 py-0.5 font-mono text-[11px] font-bold text-bmw-blue">
            {selected.fullCode}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="الممر">
          <Select
            value={aisle}
            onChange={(e) => {
              setAisle(e.target.value);
              setRack("");
              setShelf("");
              onChange("");
            }}
          >
            <option value="">—</option>
            {aisles.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الحامل">
          <Select
            value={rack}
            disabled={!aisle}
            onChange={(e) => {
              setRack(e.target.value);
              setShelf("");
              onChange("");
            }}
          >
            <option value="">—</option>
            {racks.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الرف">
          <Select
            value={shelf}
            disabled={!rack}
            onChange={(e) => {
              setShelf(e.target.value);
              onChange("");
            }}
          >
            <option value="">—</option>
            {shelves.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="الصندوق">
          <Select value={value} disabled={!shelf} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {boxes.map((b) => (
              <option key={b.id} value={b.id}>
                {b.boxBin}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {canCreate ? (
        creating ? (
          <div className="space-y-2 rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-3">
            {error ? <Alert variant="error">{error}</Alert> : null}
            <div className="grid grid-cols-4 gap-2">
              {(["aisle", "rack", "shelf", "boxBin"] as const).map((key) => (
                <Input
                  key={key}
                  value={draft[key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value.toUpperCase() }))}
                  placeholder={{ aisle: "A1", rack: "01", shelf: "A", boxBin: "12" }[key]}
                  className="h-9 text-center font-mono text-xs"
                  maxLength={10}
                />
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={submitNewBin}
                loading={pending}
                disabled={!draft.aisle || !draft.rack || !draft.shelf || !draft.boxBin}
              >
                إنشاء الموقع
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)} disabled={pending}>
                إلغاء
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={cn(
              "flex items-center gap-1.5 text-[11px] font-bold text-bmw-blue transition-colors hover:text-bmw-electricBlue",
            )}
          >
            <Plus size={13} /> إضافة موقع تخزين جديد
          </button>
        )
      ) : null}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Input } from "./input";

export interface CreatableOption {
  id: string;
  label: string;
  meta?: string;
}

interface CreatableComboboxProps {
  label: string;
  value?: string;
  options: CreatableOption[];
  required?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  onChange: (option: CreatableOption | null) => void;
  onCreate?: (label: string) => void;
}

export function CreatableCombobox({ label, value, options, required, clearable, disabled, onChange, onCreate }: CreatableComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value) ?? null;
  const normalized = query.trim().toLocaleLowerCase("ar-EG");
  const matches = useMemo(() => options.filter((option) => option.label.toLocaleLowerCase("ar-EG").includes(normalized)).slice(0, 12), [options, normalized]);
  const exact = options.some((option) => option.label.trim().toLocaleLowerCase("ar-EG") === normalized);

  return (
    <div className="relative" dir="rtl">
      <div className="flex items-center gap-2">
        <Input
          aria-label={label}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={open ? query : selected?.label ?? query}
          disabled={disabled}
          required={required}
          placeholder={label}
          onFocus={() => { setOpen(true); setQuery(selected?.label ?? ""); }}
          onChange={(event) => { setOpen(true); setQuery(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
            if (event.key === "Enter" && normalized && !exact && onCreate) { event.preventDefault(); onCreate(query.trim()); setOpen(false); }
          }}
        />
        {clearable && selected ? <button type="button" aria-label={`مسح ${label}`} onClick={() => onChange(null)} className="rounded p-2 text-bmw-muted hover:text-white"><X size={16} /></button> : null}
      </div>
      {open ? <div role="listbox" className="absolute z-40 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-bmw-cardBorder bg-bmw-carbon shadow-xl">
        {matches.map((option) => <button key={option.id} type="button" role="option" aria-selected={option.id === value} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option); setQuery(""); setOpen(false); }} className="block w-full px-3 py-2 text-right text-sm hover:bg-bmw-card">
          <strong>{option.label}</strong>{option.meta ? <span className="mr-2 text-xs text-bmw-muted">{option.meta}</span> : null}
        </button>)}
        {normalized && !exact && onCreate ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onCreate(query.trim()); setOpen(false); }} className="block w-full border-t border-bmw-cardBorder px-3 py-2 text-right text-sm font-bold text-bmw-blue hover:bg-bmw-card">+ إضافة “{query.trim()}” جديدة</button> : null}
      </div> : null}
    </div>
  );
}

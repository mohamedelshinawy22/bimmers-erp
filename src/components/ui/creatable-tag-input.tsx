"use client";

import { KeyboardEvent, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Input } from "./input";
import type { CreatableOption } from "./creatable-combobox";

interface CreatableTagInputProps {
  label: string;
  values: CreatableOption[];
  options: CreatableOption[];
  onChange: (values: CreatableOption[]) => void;
  onCreate?: (label: string) => void;
}

export function CreatableTagInput({ label, values, options, onChange, onCreate }: CreatableTagInputProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => options.filter((option) => !values.some((value) => value.id === option.id) && option.label.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 10), [options, query, values]);
  const addTyped = () => {
    const labelValue = query.trim().replace(/\s+/g, " ").toUpperCase();
    if (!labelValue) return;
    const known = options.find((option) => option.label.toUpperCase() === labelValue);
    if (known && !values.some((value) => value.id === known.id)) onChange([...values, known]);
    else if (onCreate) onCreate(labelValue);
    setQuery("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTyped(); }
    if (event.key === "Backspace" && !query && values.length) onChange(values.slice(0, -1));
  };
  return <div dir="rtl" className="space-y-2">
    <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-xl border border-bmw-cardBorder bg-bmw-black p-2">
      {values.map((value) => <span key={value.id} className="inline-flex items-center gap-1 rounded-lg bg-bmw-card px-2 py-1 text-xs"><span>{value.label}</span><button type="button" aria-label={`حذف ${value.label}`} onClick={() => onChange(values.filter((item) => item.id !== value.id))}><X size={12} /></button></span>)}
      <Input aria-label={label} value={query} placeholder={values.length ? "إضافة كود…" : label} className="h-7 min-w-32 flex-1 border-0 bg-transparent p-0" onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} />
    </div>
    {query ? <div role="listbox" className="max-h-40 overflow-auto rounded-lg border border-bmw-cardBorder bg-bmw-carbon">
      {filtered.map((option) => <button key={option.id} type="button" role="option" onClick={() => { onChange([...values, option]); setQuery(""); }} className="block w-full px-3 py-2 text-right text-sm hover:bg-bmw-card">{option.label}</button>)}
      {onCreate ? <button type="button" onClick={addTyped} className="block w-full border-t border-bmw-cardBorder px-3 py-2 text-right text-sm font-bold text-bmw-blue">+ إضافة “{query}”</button> : null}
    </div> : null}
  </div>;
}

"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, Plus, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createAccountAction } from "@/server/actions/accounts.actions";
import { CURRENCY, formatMoney } from "@/lib/utils";

export type VoucherAccountOption = {
  id: string;
  name: string;
  accountNumber: string;
  type: string;
  phone: string | null;
  currentBalance: number;
};

type VoucherType = "RECEIPT" | "PAYMENT";

type Props = {
  accounts: VoucherAccountOption[];
  selectedId: string | null;
  onSelect: (account: VoucherAccountOption | null) => void;
  voucherType: VoucherType;
  disabled?: boolean;
};

const normalize = (value: string) => value
  .toLocaleLowerCase("ar-EG")
  .replace(/[أإآٱ]/g, "ا")
  .replace(/[ىي]/g, "ي")
  .replace(/ة/g, "ه")
  .replace(/[\u064B-\u065F]/g, "")
  .replace(/[\s_\-]/g, "")
  .trim();

const accountTypeMeta = (type: string) => {
  if (type === "SUPPLIER") return { label: "مورد", className: "border-amber-400/30 bg-amber-400/10 text-amber-300" };
  if (type === "WORKSHOP_BMW") return { label: "ورشة", className: "border-purple-400/30 bg-purple-400/10 text-purple-300" };
  if (type === "EXPENSE") return { label: "مصروف", className: "border-slate-500/30 bg-slate-500/10 text-slate-300" };
  return { label: "عميل", className: "border-bmw-blue/30 bg-bmw-blue/10 text-bmw-blue" };
};

function matchesAccount(account: VoucherAccountOption, query: string) {
  const needle = normalize(query);
  if (!needle) return true;
  return [account.name, account.accountNumber, account.phone ?? "", accountTypeMeta(account.type).label].some((value) => normalize(value).includes(needle));
}

export function AccountCombobox({ accounts: initialAccounts, selectedId, onSelect, voucherType, disabled = false }: Props) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [quickCreateError, setQuickCreateError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const selected = useMemo(() => accounts.find((account) => account.id === selectedId) ?? null, [accounts, selectedId]);
  const visibleAccounts = useMemo(() => accounts.filter((account) => matchesAccount(account, query)).slice(0, 100), [accounts, query]);
  const trimmedQuery = query.trim();
  const exactMatch = useMemo(() => Boolean(trimmedQuery) && accounts.some((account) => normalize(account.name) === normalize(trimmedQuery)), [accounts, trimmedQuery]);
  const canQuickCreate = Boolean(trimmedQuery) && !exactMatch;

  useEffect(() => setAccounts(initialAccounts), [initialAccounts]);
  useEffect(() => setActiveIndex(0), [query, visibleAccounts.length]);
  useEffect(() => {
    const closeOnOutsidePointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsidePointer);
    return () => document.removeEventListener("mousedown", closeOnOutsidePointer);
  }, []);

  const choose = (account: VoucherAccountOption | null) => {
    onSelect(account);
    setOpen(false);
    setQuery("");
    setQuickCreateError(null);
  };

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setQuickCreateError(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openList();
      setActiveIndex((index) => Math.min(Math.max(0, visibleAccounts.length - 1), index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      openList();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter" && open && visibleAccounts.length) {
      event.preventDefault();
      choose(visibleAccounts[activeIndex] ?? visibleAccounts[0] ?? null);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  const quickCreate = () => {
    if (!canQuickCreate || pending) return;
    setQuickCreateError(null);
    const type = voucherType === "RECEIPT" ? "CUSTOMER" : "SUPPLIER";
    startTransition(async () => {
      const result = await createAccountAction({
        name: trimmedQuery,
        type,
        phone: "",
        email: "",
        address: "",
        taxNumber: "",
        category: "",
        creditLimit: 0,
        openingBalance: 0,
        defaultPriceTier: "RETAIL",
        status: "ACTIVE",
      });
      if (!result.success) {
        setQuickCreateError(result.error);
        return;
      }
      const account: VoucherAccountOption = {
        id: result.data.id,
        name: result.data.name,
        accountNumber: result.data.accountNumber,
        type: result.data.type,
        phone: result.data.phone,
        currentBalance: result.data.currentBalance,
      };
      setAccounts((previous) => [account, ...previous.filter((entry) => entry.id !== account.id)]);
      choose(account);
    });
  };

  const displayValue = open ? query : selected ? `${selected.name} — ${selected.accountNumber}` : "";
  return <div className="relative" dir="rtl" ref={rootRef}>
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted" />
      <Input
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open && visibleAccounts.length ? `${listId}-${visibleAccounts[activeIndex]?.id}` : undefined}
        value={displayValue}
        disabled={disabled}
        onClick={openList}
        onFocus={openList}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setQuickCreateError(null); }}
        onKeyDown={onKeyDown}
        placeholder="ابحث بالاسم أو الكود أو الهاتف…"
        className="h-11 pr-9 pl-16"
      />
      {selected && !open && !disabled ? <button type="button" aria-label="اختيار نقدي عام بدون حساب" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(null)} className="absolute left-8 top-1/2 -translate-y-1/2 text-bmw-muted hover:text-white"><X size={15} /></button> : null}
      <button type="button" aria-label={open ? "إغلاق قائمة الحسابات" : "فتح قائمة الحسابات"} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (open) setOpen(false); else { openList(); inputRef.current?.focus(); } }} className="absolute left-2 top-1/2 -translate-y-1/2 text-bmw-muted hover:text-white disabled:cursor-not-allowed"><ChevronDown size={16} className={open ? "rotate-180 transition-transform" : "transition-transform"} /></button>
    </div>
    {selected ? <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-bmw-blue/20 bg-bmw-blue/5 px-2 py-1.5 text-xs"><span className="min-w-0 truncate font-semibold text-white">{selected.name} <span className="font-mono text-bmw-muted">{selected.accountNumber}</span></span><span className={selected.currentBalance < 0 ? "font-mono text-bmw-mRed" : selected.currentBalance > 0 ? "font-mono text-emerald-400" : "font-mono text-bmw-muted"}>{formatMoney(selected.currentBalance)} {CURRENCY}</span></div> : null}
    {open ? <div id={listId} role="listbox" className="absolute z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-1.5 shadow-2xl">
      <button role="option" aria-selected={!selectedId} type="button" onMouseDown={(event) => { event.preventDefault(); choose(null); }} className={`flex w-full items-center justify-between gap-2 rounded-lg p-2 text-right text-sm transition-colors ${!selectedId ? "bg-bmw-blue/10 text-bmw-blue" : "text-bmw-silver hover:bg-bmw-card"}`}><span className="flex items-center gap-2"><UserRound size={15} /> بدون حساب (نقدي عام)</span>{!selectedId ? <Check size={15} /> : null}</button>
      <div className="my-1 border-t border-bmw-cardBorder" />
      {visibleAccounts.map((account, index) => {
        const meta = accountTypeMeta(account.type);
        const active = index === activeIndex;
        return <button key={account.id} id={`${listId}-${account.id}`} role="option" aria-selected={account.id === selectedId} type="button" onMouseDown={(event) => { event.preventDefault(); choose(account); }} onMouseEnter={() => setActiveIndex(index)} className={`flex w-full items-center justify-between gap-2 rounded-lg p-2 text-right transition-colors ${active ? "bg-slate-800/80" : "hover:bg-slate-800/80"}`}><span className="min-w-0 text-right"><span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold text-white">{account.name}</span><span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${meta.className}`}>{meta.label}</span></span><span className="block truncate font-mono text-xs text-bmw-muted">{account.accountNumber}{account.phone ? ` • ${account.phone}` : ""}</span></span><span className="flex shrink-0 items-center gap-1.5"><span className={account.currentBalance < 0 ? "font-mono text-xs text-bmw-mRed" : account.currentBalance > 0 ? "font-mono text-xs text-emerald-400" : "font-mono text-xs text-bmw-muted"}>{formatMoney(account.currentBalance)} {CURRENCY}</span>{account.id === selectedId ? <Check size={15} className="text-bmw-blue" /> : null}</span></button>;
      })}
      {!visibleAccounts.length ? <p className="px-2 py-3 text-center text-xs text-bmw-muted">لا توجد حسابات مطابقة.</p> : null}
      {canQuickCreate ? <div className="mt-1 border-t border-bmw-cardBorder p-1 pt-2"><Button type="button" size="sm" variant="primary" className="w-full" onMouseDown={(event) => event.preventDefault()} onClick={quickCreate} disabled={pending}>{pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}<span>إضافة «{trimmedQuery}» كـ {voucherType === "RECEIPT" ? "عميل" : "مورد"} جديد</span></Button>{quickCreateError ? <p className="px-1 pt-2 text-center text-xs text-bmw-mRed">{quickCreateError}</p> : null}</div> : null}
    </div> : null}
  </div>;
}

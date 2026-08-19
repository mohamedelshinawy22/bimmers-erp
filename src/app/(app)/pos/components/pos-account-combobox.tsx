"use client";

import { forwardRef, useEffect, useId, useMemo, useState } from "react";
import { Search, UserPlus, X } from "lucide-react";
import type { PosAccount } from "@/server/services/accounts.service";
import { searchPosAccountsAction } from "@/server/actions/search.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CURRENCY, formatMoney } from "@/lib/utils";

const accountTypeLabel = (type: PosAccount["type"]) => type === "WORKSHOP_BMW" ? "ورشة" : "عميل";
const tierLabel = (tier: string) => tier === "WHOLESALE" ? "جملة" : "قطاعي";
const normalized = (value: string) => value.toLocaleLowerCase("ar-EG").replace(/[أإآٱ]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه").replace(/[\u064B-\u065F]/g, "").trim();

function matchesAccount(account: PosAccount, query: string) {
  const needle = normalized(query);
  if (!needle) return true;
  return [account.name, account.accountNumber, account.phone ?? "", accountTypeLabel(account.type), tierLabel(account.defaultPriceTier)].some((value) => normalized(value).includes(needle));
}

interface POSAccountComboboxProps {
  accounts: PosAccount[];
  selectedId: string;
  onSelect: (account: PosAccount) => void;
  onQuickCreate: () => void;
  onMoveToPartSearch: () => void;
}

export const POSAccountCombobox = forwardRef<HTMLInputElement, POSAccountComboboxProps>(function POSAccountCombobox({ accounts, selectedId, onSelect, onQuickCreate, onMoveToPartSearch }, ref) {
  const selected = accounts.find((account) => account.id === selectedId);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteAccounts, setRemoteAccounts] = useState<PosAccount[]>([]);
  const [searching, setSearching] = useState(false);
  const listId = useId();

  const localAccounts = useMemo(() => accounts.filter((account) => matchesAccount(account, query)), [accounts, query]);
  const visibleAccounts = useMemo(() => {
    const merged = new Map<string, PosAccount>();
    [...localAccounts, ...remoteAccounts].forEach((account) => merged.set(account.id, account));
    return Array.from(merged.values()).sort((first, second) => first.name.localeCompare(second.name, "ar")).slice(0, 30);
  }, [localAccounts, remoteAccounts]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, visibleAccounts.length]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setRemoteAccounts([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const result = await searchPosAccountsAction(term);
      if (cancelled) return;
      setSearching(false);
      setRemoteAccounts(result.success ? result.data : []);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  const choose = (account: PosAccount) => {
    onSelect(account);
    setQuery("");
    setOpen(false);
    onMoveToPartSearch();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(Math.max(0, visibleAccounts.length - 1), index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter" && open && visibleAccounts.length) {
      event.preventDefault();
      choose(visibleAccounts[activeIndex] ?? visibleAccounts[0]!);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  return <div className="relative" dir="rtl">
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted" />
      <Input
        ref={ref}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open && visibleAccounts.length ? `${listId}-${visibleAccounts[activeIndex]?.id}` : undefined}
        value={query}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder={selected ? `الحساب الحالي: ${selected.name}` : "ابحث باسم العميل أو الكود أو الهاتف… (F7)"}
        className="h-11 pr-9 pl-9"
      />
      {query ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setQuery(""); setRemoteAccounts([]); }} className="absolute left-3 top-1/2 -translate-y-1/2 text-bmw-muted hover:text-white" aria-label="مسح البحث"><X size={15} /></button> : null}
    </div>
    {selected ? <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-bmw-blue/25 bg-bmw-blue/5 px-2 py-1.5 text-xs"><span className="truncate font-semibold text-white">{selected.name} <span className="font-mono text-bmw-muted">{selected.accountNumber}</span></span><span className="shrink-0 text-bmw-blue">{tierLabel(selected.defaultPriceTier)}</span></div> : null}
    <div className="mt-2 flex justify-end"><Button type="button" size="sm" variant="outline" onClick={onQuickCreate}><UserPlus size={14}/> حساب سريع (Alt+N)</Button></div>
    {open ? <div id={listId} role="listbox" className="absolute z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-bmw-cardBorder bg-bmw-carbon p-1.5 shadow-2xl">{searching ? <p className="px-2 py-2 text-xs text-bmw-muted">يتم البحث في الحسابات…</p> : null}{visibleAccounts.map((account, index) => {
      const active = index === activeIndex;
      const balanceClass = account.currentBalance < 0 ? "bg-bmw-mRed/10 text-bmw-mRed" : "bg-emerald-500/10 text-emerald-400";
      return <button key={account.id} id={`${listId}-${account.id}`} role="option" aria-selected={account.id === selectedId} type="button" onMouseDown={(event) => { event.preventDefault(); choose(account); }} onMouseEnter={() => setActiveIndex(index)} className={`flex w-full items-center justify-between gap-2 rounded-lg p-2 text-right transition-colors ${active ? "bg-slate-800/80" : "hover:bg-slate-800/80"}`}>
        <span className="min-w-0 text-right"><span className="block truncate text-sm font-semibold text-slate-100">{account.name}</span><span className="block truncate font-mono text-xs text-slate-400">{account.accountNumber}{account.phone ? ` • ${account.phone}` : ""}</span></span>
        <span className="flex shrink-0 items-center gap-1.5"><span className={`rounded px-2 py-0.5 font-mono text-xs ${balanceClass}`}>{formatMoney(Math.abs(account.currentBalance))} {CURRENCY}</span><span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">{tierLabel(account.defaultPriceTier)} · {accountTypeLabel(account.type)}</span></span>
      </button>;
    })}{!searching && visibleAccounts.length === 0 ? <p className="px-2 py-3 text-center text-xs text-bmw-muted">لا توجد حسابات مطابقة. يمكنك إنشاء حساب سريع.</p> : null}</div> : null}
  </div>;
});

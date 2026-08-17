"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, Search, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, formatInt } from "@/lib/utils";
import type { AuditRow } from "@/server/services/audit.service";

const ACTION_LABELS: Record<string, string> = {
  INSERT: "إضافة",
  UPDATE: "تعديل",
  DELETE: "حذف",
  VOID: "إلغاء",
  LOGIN: "دخول",
  LOGIN_FAILED: "محاولة دخول فاشلة",
  LOGOUT: "خروج",
};

const TABLE_LABELS: Record<string, string> = {
  Invoice: "فاتورة",
  PartItem: "صنف",
  Account: "حساب",
  CustomerVehicle: "سيارة عميل",
  Treasury: "خزينة",
  TreasuryTransaction: "حركة خزينة",
  TreasuryShift: "وردية",
  WarehouseBin: "موقع تخزين",
  SystemSetting: "إعداد",
  User: "مستخدم",
};

const ACTION_VARIANT: Record<string, "success" | "blue" | "danger" | "warning" | "muted"> = {
  INSERT: "success",
  UPDATE: "blue",
  DELETE: "danger",
  VOID: "danger",
  LOGIN: "muted",
  LOGIN_FAILED: "warning",
  LOGOUT: "muted",
};

interface AuditClientProps {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: { tableName: string; action: string; query: string };
  options: { tables: Array<{ name: string; count: number }>; actions: Array<{ name: string; count: number }> };
}

export function AuditClient({ rows, total, page, pageSize, filters, options }: AuditClientProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(filters.query);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const push = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    router.push(`/audit?${next.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-bmw-blue/30 bg-bmw-blue/10 p-2.5 text-bmw-blue">
          <ShieldCheck size={22} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">سجل التدقيق</h1>
          <p className="text-xs text-bmw-muted">
            {formatInt(total)} حركة مسجّلة — سجل غير قابل للتعديل يُكتب داخل نفس معاملة التغيير
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              push({ q: query });
            }}
          >
            <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-bmw-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث بمعرّف السجل…"
              className="pr-9"
            />
          </form>
          <Select value={filters.tableName} onChange={(e) => push({ table: e.target.value })}>
            <option value="">كل الجداول</option>
            {options.tables.map((t) => (
              <option key={t.name} value={t.name}>
                {TABLE_LABELS[t.name] ?? t.name} ({t.count})
              </option>
            ))}
          </Select>
          <Select value={filters.action} onChange={(e) => push({ action: e.target.value })}>
            <option value="">كل العمليات</option>
            {options.actions.map((a) => (
              <option key={a.name} value={a.name}>
                {ACTION_LABELS[a.name] ?? a.name} ({a.count})
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <THead>
            <TR>
              <TH>التاريخ والوقت</TH>
              <TH>العملية</TH>
              <TH>الجدول</TH>
              <TH>معرّف السجل</TH>
              <TH>المستخدم</TH>
              <TH>عنوان IP</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <EmptyState colSpan={7} title="لا توجد حركات مطابقة" icon={<ShieldCheck size={30} />} />
            ) : (
              rows.map((r) => (
                <TR key={r.id}>
                  <TD className="tabular whitespace-nowrap text-xs">{formatDateTime(r.timestamp)}</TD>
                  <TD>
                    <Badge variant={ACTION_VARIANT[r.action] ?? "muted"}>
                      {ACTION_LABELS[r.action] ?? r.action}
                    </Badge>
                  </TD>
                  <TD className="text-xs">{TABLE_LABELS[r.tableName] ?? r.tableName}</TD>
                  <TD className="max-w-[180px] truncate font-mono text-[10px] text-bmw-muted">{r.recordId}</TD>
                  <TD className="text-xs">{r.performedByName ?? r.performedBy}</TD>
                  <TD className="font-mono text-[10px] text-bmw-muted" dir="ltr">
                    {r.ipAddress ?? "—"}
                  </TD>
                  <TD>
                    <button
                      type="button"
                      onClick={() => setDetail(r)}
                      title="عرض البيانات"
                      className="rounded-lg p-1.5 text-bmw-muted transition-colors hover:bg-bmw-blue/10 hover:text-bmw-blue"
                    >
                      <Eye size={14} />
                    </button>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        {pageCount > 1 ? (
          <div className="flex items-center justify-between border-t border-bmw-cardBorder px-4 py-3">
            <p className="text-xs text-bmw-muted">
              صفحة <span className="tabular font-bold text-white">{page}</span> من{" "}
              <span className="tabular">{pageCount}</span>
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => push({ page: String(page - 1) })}>
                السابق
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pageCount}
                onClick={() => push({ page: String(page + 1) })}
              >
                التالي
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {detail ? (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={`${ACTION_LABELS[detail.action] ?? detail.action} — ${TABLE_LABELS[detail.tableName] ?? detail.tableName}`}
          description={`${formatDateTime(detail.timestamp)} • ${detail.performedByName ?? detail.performedBy}`}
          size="lg"
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <JsonBlock title="قبل التعديل" data={detail.oldData} />
            <JsonBlock title="بعد التعديل" data={detail.newData} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function JsonBlock({ title, data }: { title: string; data: unknown }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-bold text-bmw-blue">{title}</p>
      <pre
        dir="ltr"
        className="max-h-72 overflow-auto rounded-xl border border-bmw-cardBorder bg-bmw-black p-3 text-left font-mono text-[10px] leading-relaxed text-bmw-silver"
      >
        {data === null || data === undefined ? "—" : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

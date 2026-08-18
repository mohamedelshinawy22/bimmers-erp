"use client";

import { Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SelectionActionToolbar({
  count,
  itemLabel = "عنصر",
  onEdit,
  onDelete,
  deleteLabel = "حذف نهائي",
  onClear,
  deleteDisabled = false,
}: {
  count: number;
  itemLabel?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  onClear: () => void;
  deleteDisabled?: boolean;
}) {
  if (count === 0) return null;
  return <div className="fixed inset-x-4 bottom-5 z-40 mx-auto flex w-auto max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-bmw-mRed/40 bg-bmw-black/95 px-4 py-3 shadow-2xl backdrop-blur" dir="rtl"><p className="text-sm font-bold text-white">تم تحديد <span className="tabular text-bmw-blue">{count}</span> {itemLabel}</p><div className="flex flex-wrap gap-2">{onEdit && count === 1 ? <Button size="sm" variant="outline" onClick={onEdit}><Pencil size={15} /> تعديل</Button> : null}{onDelete ? <Button size="sm" variant="danger" onClick={onDelete} disabled={deleteDisabled}><Trash2 size={15} /> {deleteLabel}</Button> : null}<Button size="sm" variant="ghost" onClick={onClear}><X size={15} /> إلغاء التحديد</Button></div></div>;
}

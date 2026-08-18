"use client";

import { ChangeEvent, DragEvent, useEffect, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "./button";

interface ImageUploaderProps {
  value?: string | null;
  onChange: (file: File | null) => void;
  maxBytes?: number;
}

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export function ImageUploader({ value, onChange, maxBytes = 5 * 1024 * 1024 }: ImageUploaderProps) {
  const [preview, setPreview] = useState<string | null>(value ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);
  const select = (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type) || file.size > maxBytes) { setError("يسمح فقط بملفات JPG أو PNG أو WebP حتى 5 ميجابايت."); return; }
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file)); setError(null); onChange(file);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); select(event.dataTransfer.files[0]); };
  return <div className="space-y-2" dir="rtl">
    <div onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className="rounded-xl border border-dashed border-bmw-cardBorder bg-bmw-black p-3 text-center">
      {preview ? <img src={preview} alt="معاينة الصنف" className="mx-auto max-h-40 rounded-lg object-contain" /> : <ImagePlus className="mx-auto text-bmw-muted" size={28} />}
      <label className="mt-2 inline-block cursor-pointer text-sm font-bold text-bmw-blue">اختيار أو سحب صورة<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => select(event.target.files?.[0])} /></label>
    </div>
    {error ? <p className="text-xs text-bmw-mRed">{error}</p> : null}
    {preview ? <Button type="button" size="sm" variant="ghost" onClick={() => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); setPreview(null); onChange(null); }}><Trash2 size={14} /> إزالة الصورة</Button> : null}
  </div>;
}

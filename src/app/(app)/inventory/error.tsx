"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function InventoryError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Inventory route rendering error", error);
  }, [error]);

  return (
    <main className="space-y-3" dir="rtl" role="alert">
      <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        <strong>تعذر عرض كتالوج البضاعة مؤقتاً.</strong>
        <p className="mt-1 text-amber-100/80">لم يتم تعديل أي بيانات. أعد المحاولة؛ ستبقى بيانات الأصناف المستوردة محفوظة.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={reset}>
          <RefreshCw size={15} /> إعادة المحاولة
        </Button>
      </div>
    </main>
  );
}

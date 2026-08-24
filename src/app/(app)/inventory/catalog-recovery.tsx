"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CatalogRecovery() {
  return (
    <main className="space-y-3" dir="rtl" role="alert">
      <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        <strong>تعذر تحميل كتالوج البضاعة مؤقتاً.</strong>
        <p className="mt-1 text-amber-100/80">لم يتم تعديل أي بيانات. أعد تحميل الصفحة للمحاولة مرة أخرى.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => window.location.reload()}>
          <RefreshCw size={15} /> إعادة التحميل
        </Button>
      </div>
    </main>
  );
}

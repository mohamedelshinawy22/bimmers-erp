import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { backupFileName, createFullBackupSnapshot } from "@/server/services/system-backup.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const actor = await requirePermission("system.backup");
    const snapshot = await createFullBackupSnapshot(actor);
    return new NextResponse(JSON.stringify(snapshot), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${backupFileName()}"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "تعذر إنشاء النسخة الاحتياطية أو ليس لديك الصلاحية المطلوبة." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { AuthError, BusinessRuleError, ForbiddenError } from "@/lib/errors";
import { restoreFullBackupSnapshot } from "@/server/services/system-backup.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "حدث خطأ غير متوقع أثناء الاستعادة.";
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return NextResponse.json({ error: "طلب الاستعادة غير مسموح من هذا المصدر." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const actor = await requirePermission("system.maintenance");
    const formData = await request.formData();
    const file = formData.get("file");
    const adminPassword = String(formData.get("adminPassword") ?? "");
    const confirmationPhrase = String(formData.get("confirmationPhrase") ?? "");
    if (!file || typeof file === "string" || typeof file.text !== "function") {
      return NextResponse.json({ error: "اختر ملف نسخة احتياطية بصيغة JSON." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (!file.name.toLowerCase().endsWith(".json") || file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "ملف النسخة الاحتياطية يجب أن يكون JSON ولا يتجاوز 50MB." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const backupJson = await file.text();
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(backupJson);
    } catch {
      return NextResponse.json({ error: "ملف النسخة الاحتياطية تالف أو ليس JSON صالحاً." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const summary = await restoreFullBackupSnapshot({ actor, adminPassword, confirmationPhrase, snapshot, serializedBytes: Buffer.byteLength(backupJson, "utf8") });
    return NextResponse.json({ success: true, summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : error instanceof ForbiddenError ? 403 : error instanceof BusinessRuleError ? 400 : 500;
    return NextResponse.json({ error: errorMessage(error) }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { AuthError, BusinessRuleError, ForbiddenError } from "@/lib/errors";
import { applyCategoryParentLinks, finalizeChunkedRestore } from "@/server/services/chunked-restore.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "حدث خطأ غير متوقع أثناء إتمام الاستعادة.";
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "طلب الاستعادة غير مسموح من هذا المصدر." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const actor = await requirePermission("system.maintenance");
    const body = await request.json() as { restoreToken?: unknown; action?: unknown; rows?: unknown; actorProfile?: { allowedTreasuryIds?: unknown; allowedWarehouseIds?: unknown; transferToTreasuryId?: unknown } };
    const restoreToken = String(body.restoreToken ?? "");
    if (body.action === "category-links") {
      const result = await applyCategoryParentLinks({ actor, restoreToken, rows: body.rows });
      return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "complete") {
      const profile = body.actorProfile ? {
        allowedTreasuryIds: Array.isArray(body.actorProfile.allowedTreasuryIds) ? body.actorProfile.allowedTreasuryIds.filter((value): value is string => typeof value === "string") : [],
        allowedWarehouseIds: Array.isArray(body.actorProfile.allowedWarehouseIds) ? body.actorProfile.allowedWarehouseIds.filter((value): value is string => typeof value === "string") : [],
        transferToTreasuryId: typeof body.actorProfile.transferToTreasuryId === "string" ? body.actorProfile.transferToTreasuryId : null,
      } : undefined;
      const result = await finalizeChunkedRestore({ actor, restoreToken, actorProfile: profile });
      return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ success: false, error: "إجراء الإنهاء غير مدعوم." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AuthError ? 401 : error instanceof ForbiddenError ? 403 : error instanceof BusinessRuleError ? 400 : 500;
    return NextResponse.json({ success: false, error: errorMessage(error) }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requirePermission, AuthError, ForbiddenError } from "@/lib/auth";
import { toActionError } from "@/lib/action-result";
import { getTenantDbFromSession } from "@/server/db/get-tenant-db";
import { importCatalogApiChunk } from "@/server/services/catalog-import-api.service";

export const dynamic = "force-dynamic";

/**
 * JSON-only import boundary. It intentionally avoids Server Action transport
 * and does not revalidate RSC data until the browser refreshes after all chunks.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requirePermission("inventory.import");
    const body = await request.json();
    const tenant = await getTenantDbFromSession();
    const data = await tenant.run(() => importCatalogApiChunk(tenant.prisma, user.id, body));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const result = toActionError(error, "catalog-import-api");
    const status = error instanceof AuthError ? 401 : error instanceof ForbiddenError ? 403 : 400;
    return NextResponse.json(result, { status });
  }
}

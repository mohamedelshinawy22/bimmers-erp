import { NextRequest, NextResponse } from "next/server";
import { executeInventoryImportAction } from "@/server/actions/import.actions";

export const dynamic = "force-dynamic";

/**
 * JSON-only import boundary. It intentionally avoids Server Action transport
 * and does not revalidate RSC data until the browser refreshes after all chunks.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await executeInventoryImportAction(body, { revalidate: false });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error) {
    console.error("[catalog-import-api] unexpected request failure", error);
    return NextResponse.json({ success: false, error: "تعذر معالجة دفعة الأصناف. أعد المحاولة." }, { status: 400 });
  }
}

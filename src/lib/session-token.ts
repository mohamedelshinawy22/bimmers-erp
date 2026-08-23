import { jwtVerify } from "jose";

export type VerifiedSessionClaims = {
  id: string;
  username: string;
  fullName: string;
  role: string;
  tenantId: string;
};

export function sessionSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("إعداد الخادم غير مكتمل: متغير البيئة JWT_SECRET غير مضبوط أو أقل من ٣٢ حرفاً.");
  }
  return new TextEncoder().encode(secret);
}

export async function verifySessionToken(token: string): Promise<VerifiedSessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecretKey(), {
      issuer: "bimmer-erp",
      audience: "bimmer-erp-web",
    });
    if (!payload.sub || typeof payload.username !== "string" || typeof payload.tenantId !== "string" || !/^[a-zA-Z0-9-]{3,64}$/.test(payload.tenantId)) return null;
    return {
      id: payload.sub,
      username: payload.username,
      fullName: String(payload.fullName ?? payload.username),
      role: String(payload.role ?? ""),
      tenantId: payload.tenantId,
    };
  } catch {
    return null;
  }
}

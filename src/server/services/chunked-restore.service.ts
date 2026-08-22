import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BusinessRuleError } from "@/lib/errors";
import { BACKUP_TABLES, sanitizeBackupRows } from "@/server/services/system-backup.service";

const RESTORE_CONFIRMATION_PHRASE = "استعادة نسخة احتياطية";
const RESTORE_TOKEN_ISSUER = "bimmer-erp-restore";
const RESTORE_TOKEN_AUDIENCE = "bimmer-erp-restore-chunk";
const RESTORE_TOKEN_TTL = "20m";
const MAX_CHUNK_ROWS = 200;
const MAX_CHUNK_BYTES = 900 * 1024;

type RestoreActor = { id: string; fullName: string; role: Role };
type RestoreTokenPayload = { actorId: string; actorName: string; backupCreatedAt: string; checksum: string; nonce: string };
type SnapshotTable = (typeof BACKUP_TABLES)[number];
type JsonRow = Record<string, unknown>;

const TABLE_RANK = Object.fromEntries(BACKUP_TABLES.map((table, index) => [table, index])) as Record<SnapshotTable, number>;

function key(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new BusinessRuleError("إعداد الخادم غير مكتمل: JWT_SECRET غير صالح.");
  return new TextEncoder().encode(secret);
}

function requireSuperAdmin(actor: RestoreActor) {
  if (actor.role !== "SUPER_ADMIN") throw new BusinessRuleError("صلاحية الاستعادة المتدرجة متاحة لمدير النظام فقط.");
}

async function signRestoreToken(actor: RestoreActor, metadata: { createdAt: string; checksum: string }) {
  return new SignJWT({ actorId: actor.id, actorName: actor.fullName, backupCreatedAt: metadata.createdAt, checksum: metadata.checksum, nonce: randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(RESTORE_TOKEN_ISSUER)
    .setAudience(RESTORE_TOKEN_AUDIENCE)
    .setExpirationTime(RESTORE_TOKEN_TTL)
    .sign(key());
}

export async function verifyChunkRestoreToken(token: string, actor: RestoreActor): Promise<RestoreTokenPayload> {
  requireSuperAdmin(actor);
  if (!token) throw new BusinessRuleError("جلسة الاستعادة المتدرجة مفقودة. أعد البدء من الخطوة الأولى.");
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: RESTORE_TOKEN_ISSUER, audience: RESTORE_TOKEN_AUDIENCE, algorithms: ["HS256"] });
    if (payload.actorId !== actor.id || typeof payload.backupCreatedAt !== "string" || typeof payload.checksum !== "string" || typeof payload.nonce !== "string") {
      throw new BusinessRuleError("جلسة الاستعادة المتدرجة غير صالحة لهذا المستخدم.");
    }
    return { actorId: actor.id, actorName: String(payload.actorName ?? actor.fullName), backupCreatedAt: payload.backupCreatedAt, checksum: payload.checksum, nonce: payload.nonce };
  } catch (error) {
    if (error instanceof BusinessRuleError) throw error;
    throw new BusinessRuleError("انتهت جلسة الاستعادة المتدرجة أو أصبحت غير صالحة. أعد البدء من الخطوة الأولى.");
  }
}

export async function initializeChunkedRestore(input: { actor: RestoreActor; adminPassword: string; confirmationPhrase: string; metadata: { createdAt: string; checksum: string } }) {
  requireSuperAdmin(input.actor);
  if (input.confirmationPhrase !== RESTORE_CONFIRMATION_PHRASE) throw new BusinessRuleError("عبارة تأكيد الاستعادة غير مطابقة.");
  if (!input.adminPassword || input.adminPassword.length > 256) throw new BusinessRuleError("كلمة مرور مدير النظام مطلوبة.");
  if (!input.metadata?.createdAt || !input.metadata?.checksum) throw new BusinessRuleError("تعريف النسخة الاحتياطية غير مكتمل.");

  const actorRow = await prisma.user.findUnique({ where: { id: input.actor.id }, select: { passwordHash: true, isActive: true } });
  const validPassword = Boolean(actorRow?.isActive) && await bcrypt.compare(input.adminPassword, actorRow?.passwordHash ?? "");
  if (!validPassword) {
    await prisma.systemAuditTrail.create({ data: { tableName: "System", recordId: "CHUNKED_BACKUP_RESTORE", action: "SYSTEM_BACKUP_RESTORE_DENIED", newData: { reason: "BAD_PASSWORD" }, performedBy: input.actor.id } });
    throw new BusinessRuleError("كلمة مرور مدير النظام غير صحيحة. تم إلغاء الاستعادة.");
  }

  await prisma.$transaction(async (tx) => {
    // Keep the session owner and its permissions so a multi-request recovery cannot lock its operator out.
    await tx.user.updateMany({ data: { allowedTreasuryIds: [], allowedWarehouseIds: [], transferToTreasuryId: null } });
    await tx.treasuryTransaction.deleteMany(); await tx.treasuryTransfer.deleteMany(); await tx.stockMovement.deleteMany(); await tx.invoiceItem.deleteMany(); await tx.heldSaleItem.deleteMany(); await tx.heldSale.deleteMany(); await tx.invoice.deleteMany(); await tx.treasuryShift.deleteMany(); await tx.installment.deleteMany(); await tx.installmentPlan.deleteMany(); await tx.accountCheck.deleteMany(); await tx.accountBalanceAdjustment.deleteMany(); await tx.customerVehicle.deleteMany(); await tx.importJob.deleteMany(); await tx.partChassis.deleteMany(); await tx.partEngine.deleteMany(); await tx.partItem.deleteMany(); await tx.warehouseBin.deleteMany(); await tx.account.deleteMany(); await tx.treasury.deleteMany(); await tx.category.updateMany({ data: { parentId: null } }); await tx.category.deleteMany(); await tx.brand.deleteMany(); await tx.bmwChassis.deleteMany(); await tx.bmwEngine.deleteMany(); await tx.barcodeConfig.deleteMany(); await tx.documentCounter.deleteMany(); await tx.systemSetting.deleteMany(); await tx.systemAuditTrail.deleteMany();
    await tx.userPermission.deleteMany({ where: { userId: { not: input.actor.id } } });
    await tx.user.deleteMany({ where: { id: { not: input.actor.id } } });
  }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 45_000 });

  return { restoreToken: await signRestoreToken(input.actor, input.metadata), actorId: input.actor.id, maxRows: MAX_CHUNK_ROWS, maxBytes: MAX_CHUNK_BYTES };
}

function asTable(value: string): SnapshotTable {
  if (!(BACKUP_TABLES as readonly string[]).includes(value)) throw new BusinessRuleError(`جدول غير مدعوم في الاستعادة: «${value}».`);
  return value as SnapshotTable;
}

function ensureChunk(rows: unknown): JsonRow[] {
  if (!Array.isArray(rows)) throw new BusinessRuleError("بيانات دفعة الاستعادة غير صالحة.");
  if (rows.length === 0) return [];
  if (rows.length > MAX_CHUNK_ROWS) throw new BusinessRuleError(`دفعة الاستعادة تتجاوز الحد الآمن (${MAX_CHUNK_ROWS} سجل).`);
  const bytes = Buffer.byteLength(JSON.stringify(rows), "utf8");
  if (bytes > MAX_CHUNK_BYTES) throw new BusinessRuleError("دفعة الاستعادة تتجاوز الحجم الآمن للطلب. قلل حجم الدفعة وأعد المحاولة.");
  return rows as JsonRow[];
}

export async function insertRestoreChunk(input: { actor: RestoreActor; restoreToken: string; table: string; rows: unknown }) {
  const token = await verifyChunkRestoreToken(input.restoreToken, input.actor);
  const table = asTable(input.table);
  const rows = ensureChunk(input.rows);
  if (!rows.length) return { count: 0, table, rank: TABLE_RANK[table] };
  const clean = sanitizeBackupRows(table, rows);

  if (table === "users") {
    const users = clean.filter((row) => row.id !== input.actor.id).map((row) => ({ ...row, transferToTreasuryId: null }));
    if (users.length) await prisma.user.createMany({ data: users as never[], skipDuplicates: true });
  } else if (table === "userPermissions") {
    const permissions = clean.filter((row) => row.userId !== input.actor.id);
    if (permissions.length) await prisma.userPermission.createMany({ data: permissions as never[], skipDuplicates: true });
  } else if (table === "categories") {
    await prisma.category.createMany({ data: clean.map((row) => ({ ...row, parentId: null })) as never[], skipDuplicates: true });
  } else if (table === "stockMovements") {
    const movements = clean.map((row) => ({ ...row, seq: BigInt(String(row.seq)) }));
    await prisma.stockMovement.createMany({ data: movements as never[], skipDuplicates: true });
  } else {
    const delegateMap = {
      brands: prisma.brand, chassis: prisma.bmwChassis, engines: prisma.bmwEngine, warehouseBins: prisma.warehouseBin, parts: prisma.partItem,
      partChassis: prisma.partChassis, partEngines: prisma.partEngine, accounts: prisma.account, accountBalanceAdjustments: prisma.accountBalanceAdjustment,
      customerVehicles: prisma.customerVehicle, treasuries: prisma.treasury, treasuryShifts: prisma.treasuryShift, invoices: prisma.invoice,
      invoiceItems: prisma.invoiceItem, heldSales: prisma.heldSale, heldSaleItems: prisma.heldSaleItem, accountChecks: prisma.accountCheck,
      installmentPlans: prisma.installmentPlan, installments: prisma.installment, treasuryTransfers: prisma.treasuryTransfer,
      treasuryTransactions: prisma.treasuryTransaction, barcodeConfigs: prisma.barcodeConfig, importJobs: prisma.importJob,
      systemAuditTrail: prisma.systemAuditTrail, documentCounters: prisma.documentCounter, systemSettings: prisma.systemSetting,
    } as const;
    const delegate = delegateMap[table as keyof typeof delegateMap] as unknown as { createMany: (args: { data: never[]; skipDuplicates: boolean }) => Promise<unknown> } | undefined;
    if (!delegate) throw new BusinessRuleError(`لا يمكن إدراج جدول «${table}» بهذه المرحلة.`);
    await delegate.createMany({ data: clean as never[], skipDuplicates: true });
  }
  return { count: clean.length, table, rank: TABLE_RANK[table], restoreSession: token.nonce };
}

export async function applyCategoryParentLinks(input: { actor: RestoreActor; restoreToken: string; rows: unknown }) {
  await verifyChunkRestoreToken(input.restoreToken, input.actor);
  const links = ensureChunk(input.rows);
  for (const row of links) {
    if (!row.id || !row.parentId) continue;
    await prisma.category.update({ where: { id: String(row.id) }, data: { parentId: String(row.parentId) } });
  }
  return { count: links.length };
}

export async function finalizeChunkedRestore(input: { actor: RestoreActor; restoreToken: string; actorProfile?: { allowedTreasuryIds?: string[]; allowedWarehouseIds?: string[]; transferToTreasuryId?: string | null } }) {
  const token = await verifyChunkRestoreToken(input.restoreToken, input.actor);
  if (input.actorProfile) {
    await prisma.user.update({ where: { id: input.actor.id }, data: {
      allowedTreasuryIds: input.actorProfile.allowedTreasuryIds ?? [], allowedWarehouseIds: input.actorProfile.allowedWarehouseIds ?? [], transferToTreasuryId: input.actorProfile.transferToTreasuryId ?? null,
    } });
  }
  await prisma.$executeRawUnsafe('SELECT setval(pg_get_serial_sequence(\'"StockMovement"\', \'seq\'), COALESCE((SELECT MAX(seq) FROM "StockMovement"), 1), EXISTS (SELECT 1 FROM "StockMovement"))');
  await prisma.systemAuditTrail.create({ data: { tableName: "System", recordId: "CHUNKED_BACKUP_RESTORE", action: "SYSTEM_BACKUP_RESTORED", newData: { mode: "CLIENT_CHUNKED", backupCreatedAt: token.backupCreatedAt, checksum: token.checksum, restoredBy: input.actor.fullName }, performedBy: input.actor.id } });
  return { backupCreatedAt: token.backupCreatedAt };
}

export const restoreChunkLimits = { maxRows: MAX_CHUNK_ROWS, maxBytes: MAX_CHUNK_BYTES, confirmationPhrase: RESTORE_CONFIRMATION_PHRASE };

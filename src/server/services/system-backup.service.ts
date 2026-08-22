import "server-only";

import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BusinessRuleError } from "@/lib/errors";
import { withTxRetry } from "@/server/services/tx";

const SNAPSHOT_FORMAT = "bimmers-erp.snapshot.v1";
const RESTORE_CONFIRMATION_PHRASE = "استعادة نسخة احتياطية";
const MAX_RESTORE_BYTES = 50 * 1024 * 1024;

export type BackupSnapshot = {
  metadata: { format: typeof SNAPSHOT_FORMAT; createdAt: string; generatedBy: string; checksum: string };
  counts: Record<string, number>;
  data: Record<string, unknown[]>;
};

const TABLES = [
  "users", "userPermissions", "brands", "categories", "chassis", "engines", "warehouseBins", "parts", "partChassis", "partEngines", "accounts", "accountBalanceAdjustments", "customerVehicles", "treasuries", "treasuryShifts", "invoices", "invoiceItems", "heldSales", "heldSaleItems", "accountChecks", "installmentPlans", "installments", "stockMovements", "treasuryTransfers", "treasuryTransactions", "barcodeConfigs", "importJobs", "systemAuditTrail", "documentCounters", "systemSettings",
] as const;

type SnapshotTable = (typeof TABLES)[number];

const SNAPSHOT_MODELS: Record<SnapshotTable, string> = {
  users: "User", userPermissions: "UserPermission", brands: "Brand", categories: "Category", chassis: "BmwChassis", engines: "BmwEngine", warehouseBins: "WarehouseBin", parts: "PartItem", partChassis: "PartChassis", partEngines: "PartEngine", accounts: "Account", accountBalanceAdjustments: "AccountBalanceAdjustment", customerVehicles: "CustomerVehicle", treasuries: "Treasury", treasuryShifts: "TreasuryShift", invoices: "Invoice", invoiceItems: "InvoiceItem", heldSales: "HeldSale", heldSaleItems: "HeldSaleItem", accountChecks: "AccountCheck", installmentPlans: "InstallmentPlan", installments: "Installment", stockMovements: "StockMovement", treasuryTransfers: "TreasuryTransfer", treasuryTransactions: "TreasuryTransaction", barcodeConfigs: "BarcodeConfig", importJobs: "ImportJob", systemAuditTrail: "SystemAuditTrail", documentCounters: "DocumentCounter", systemSettings: "SystemSetting",
};

const SCALAR_FIELDS = Object.fromEntries(Prisma.dmmf.datamodel.models.map((model) => [model.name, new Set(model.fields.filter((field) => field.kind !== "object").map((field) => field.name))])) as Record<string, Set<string>>;

const DATE_FIELDS: Partial<Record<SnapshotTable, readonly string[]>> = {
  users: ["lastLoginAt", "createdAt", "updatedAt"],
  userPermissions: ["createdAt", "updatedAt"],
  brands: ["createdAt"],
  categories: ["createdAt", "updatedAt"],
  chassis: ["createdAt"],
  engines: ["createdAt"],
  warehouseBins: ["createdAt"],
  parts: ["deletedAt", "createdAt", "updatedAt"],
  accounts: ["lastSaleDate", "lastPaymentDate", "createdAt", "updatedAt"],
  accountBalanceAdjustments: ["createdAt"],
  customerVehicles: ["createdAt"],
  treasuries: ["createdAt", "updatedAt"],
  treasuryShifts: ["openedAt", "closedAt"],
  invoices: ["voidedAt", "createdAt", "updatedAt"],
  heldSales: ["createdAt", "updatedAt"],
  accountChecks: ["issueDate", "dueDate", "createdAt", "updatedAt"],
  installmentPlans: ["startDate", "createdAt", "updatedAt"],
  installments: ["dueDate", "createdAt", "updatedAt"],
  stockMovements: ["createdAt"],
  treasuryTransfers: ["createdAt"],
  treasuryTransactions: ["voidedAt", "createdAt", "updatedAt"],
  barcodeConfigs: ["updatedAt"],
  importJobs: ["createdAt", "updatedAt"],
  systemAuditTrail: ["timestamp"],
  documentCounters: ["updatedAt"],
  systemSettings: ["updatedAt"],
};

function jsonSafe(value: unknown): unknown {
  if (value instanceof Prisma.Decimal) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function checksum(data: Record<string, unknown[]>) {
  return createHash("sha256").update(canonicalJson(data)).digest("hex");
}

function legacyChecksum(data: Record<string, unknown[]>) {
  return createHash("sha256").update(stableJson(data)).digest("hex");
}

function asRows(data: Record<string, unknown[]>, key: SnapshotTable) {
  const rows = data[key];
  if (!Array.isArray(rows)) throw new BusinessRuleError(`ملف النسخة الاحتياطية يفتقد جدول «${key}» أو يحتوي بيانات غير صالحة.`);
  return rows as Array<Record<string, unknown>>;
}

function rehydrateDateRows(table: SnapshotTable, rows: Array<Record<string, unknown>>) {
  const scalarFields = SCALAR_FIELDS[SNAPSHOT_MODELS[table]];
  if (!scalarFields) throw new BusinessRuleError(`تعذر تحميل حقول جدول الاستعادة «${table}».`);
  const dateFields = DATE_FIELDS[table] ?? [];
  return rows.map((row) => {
    // Snapshots made by older builds may carry included relations. Keep only Prisma-declared scalar/enum columns; JSON columns remain scalar and are preserved.
    const restored = Object.fromEntries(Object.entries(row).filter(([field]) => scalarFields.has(field))) as Record<string, unknown>;
    for (const field of dateFields) {
      const value = restored[field];
      if (value === null || value === undefined || value instanceof Date) continue;
      if (typeof value !== "string") throw new BusinessRuleError(`قيمة التاريخ «${field}» في جدول «${table}» غير صالحة.`);
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new BusinessRuleError(`تعذر تحويل التاريخ «${field}» في جدول «${table}».`);
      restored[field] = date;
    }
    return restored;
  });
}

function withoutKey<T extends Record<string, unknown>>(row: T, key: string) {
  const { [key]: _ignored, ...rest } = row;
  return rest;
}

async function insertInChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>, size = 250) {
  for (let start = 0; start < rows.length; start += size) await insert(rows.slice(start, start + size));
}

function summary(snapshot: BackupSnapshot) {
  return {
    createdAt: snapshot.metadata.createdAt,
    users: snapshot.counts.users ?? 0,
    parts: snapshot.counts.parts ?? 0,
    accounts: snapshot.counts.accounts ?? 0,
    treasuries: snapshot.counts.treasuries ?? 0,
    invoices: snapshot.counts.invoices ?? 0,
    transactions: snapshot.counts.treasuryTransactions ?? 0,
    stockMovements: snapshot.counts.stockMovements ?? 0,
  };
}

export function parseBackupSnapshot(raw: unknown): BackupSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BusinessRuleError("ملف النسخة الاحتياطية ليس كائناً JSON صالحاً.");
  const candidate = raw as Partial<BackupSnapshot>;
  if (candidate.metadata?.format !== SNAPSHOT_FORMAT) throw new BusinessRuleError("صيغة النسخة الاحتياطية غير مدعومة أو الملف لا يخص BimmerERP.");
  if (!candidate.metadata.createdAt || !candidate.metadata.checksum || !candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) throw new BusinessRuleError("بيانات تعريف النسخة أو حمولتها غير مكتملة.");
  const data = candidate.data as Record<string, unknown[]>;
  for (const table of TABLES) asRows(data, table);
  const actualChecksum = checksum(data);
  // Current snapshots use canonical key ordering, so whitespace and formatting never affect integrity. Accept the legacy ordered JSON checksum only for snapshots exported before this compatibility fix.
  if (actualChecksum !== candidate.metadata.checksum && legacyChecksum(data) !== candidate.metadata.checksum) throw new BusinessRuleError("فشل التحقق من سلامة النسخة الاحتياطية؛ قد يكون الملف تالفاً أو تم تعديله.");
  const counts = candidate.counts && typeof candidate.counts === "object" ? candidate.counts as Record<string, number> : {};
  return { metadata: { format: SNAPSHOT_FORMAT, createdAt: candidate.metadata.createdAt, generatedBy: candidate.metadata.generatedBy ?? "unknown", checksum: candidate.metadata.checksum }, counts, data };
}

export async function createFullBackupSnapshot(actor: { id: string; fullName: string }): Promise<BackupSnapshot> {
  const [users, userPermissions, brands, categories, chassis, engines, warehouseBins, parts, partChassis, partEngines, accounts, accountBalanceAdjustments, customerVehicles, treasuries, treasuryShifts, invoices, invoiceItems, heldSales, heldSaleItems, accountChecks, installmentPlans, installments, stockMovements, treasuryTransfers, treasuryTransactions, barcodeConfigs, importJobs, systemAuditTrail, documentCounters, systemSettings] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }), prisma.userPermission.findMany({ orderBy: { createdAt: "asc" } }), prisma.brand.findMany({ orderBy: { createdAt: "asc" } }), prisma.category.findMany({ orderBy: { createdAt: "asc" } }), prisma.bmwChassis.findMany({ orderBy: { createdAt: "asc" } }), prisma.bmwEngine.findMany({ orderBy: { createdAt: "asc" } }), prisma.warehouseBin.findMany({ orderBy: { createdAt: "asc" } }), prisma.partItem.findMany({ orderBy: { createdAt: "asc" } }), prisma.partChassis.findMany(), prisma.partEngine.findMany(), prisma.account.findMany({ orderBy: { createdAt: "asc" } }), prisma.accountBalanceAdjustment.findMany({ orderBy: { createdAt: "asc" } }), prisma.customerVehicle.findMany({ orderBy: { createdAt: "asc" } }), prisma.treasury.findMany({ orderBy: { createdAt: "asc" } }), prisma.treasuryShift.findMany({ orderBy: { openedAt: "asc" } }), prisma.invoice.findMany({ orderBy: { createdAt: "asc" } }), prisma.invoiceItem.findMany(), prisma.heldSale.findMany({ orderBy: { createdAt: "asc" } }), prisma.heldSaleItem.findMany(), prisma.accountCheck.findMany({ orderBy: { createdAt: "asc" } }), prisma.installmentPlan.findMany({ orderBy: { createdAt: "asc" } }), prisma.installment.findMany({ orderBy: { createdAt: "asc" } }), prisma.stockMovement.findMany({ orderBy: { seq: "asc" } }), prisma.treasuryTransfer.findMany({ orderBy: { createdAt: "asc" } }), prisma.treasuryTransaction.findMany({ orderBy: { createdAt: "asc" } }), prisma.barcodeConfig.findMany(), prisma.importJob.findMany({ orderBy: { createdAt: "asc" } }), prisma.systemAuditTrail.findMany({ orderBy: { timestamp: "asc" } }), prisma.documentCounter.findMany(), prisma.systemSetting.findMany({ orderBy: { key: "asc" } }),
  ]);
  const data = jsonSafe({ users, userPermissions, brands, categories, chassis, engines, warehouseBins, parts, partChassis, partEngines, accounts, accountBalanceAdjustments, customerVehicles, treasuries, treasuryShifts, invoices, invoiceItems, heldSales, heldSaleItems, accountChecks, installmentPlans, installments, stockMovements, treasuryTransfers, treasuryTransactions, barcodeConfigs, importJobs, systemAuditTrail, documentCounters, systemSettings }) as Record<string, unknown[]>;
  return { metadata: { format: SNAPSHOT_FORMAT, createdAt: new Date().toISOString(), generatedBy: actor.fullName, checksum: checksum(data) }, counts: Object.fromEntries(TABLES.map((table) => [table, data[table]?.length ?? 0])), data };
}

export async function restoreFullBackupSnapshot(input: { actor: { id: string; fullName: string; role: Role }; adminPassword: string; confirmationPhrase: string; snapshot: unknown; serializedBytes: number }) {
  if (input.actor.role !== "SUPER_ADMIN") throw new BusinessRuleError("صلاحية استعادة النسخ الاحتياطية متاحة لمدير النظام فقط.");
  if (input.confirmationPhrase !== RESTORE_CONFIRMATION_PHRASE) throw new BusinessRuleError("عبارة تأكيد الاستعادة غير مطابقة.");
  if (!input.adminPassword || input.adminPassword.length > 256) throw new BusinessRuleError("كلمة مرور مدير النظام مطلوبة.");
  if (input.serializedBytes > MAX_RESTORE_BYTES) throw new BusinessRuleError("حجم النسخة الاحتياطية يتجاوز الحد الآمن للاستعادة عبر الويب (50MB).");
  const snapshot = parseBackupSnapshot(input.snapshot);
  const actorRow = await prisma.user.findUnique({ where: { id: input.actor.id }, select: { passwordHash: true, isActive: true } });
  const passwordMatches = Boolean(actorRow?.isActive) && await bcrypt.compare(input.adminPassword, actorRow?.passwordHash ?? "");
  if (!passwordMatches) {
    await prisma.systemAuditTrail.create({ data: { tableName: "System", recordId: "BACKUP_RESTORE", action: "SYSTEM_BACKUP_RESTORE_DENIED", newData: { reason: "BAD_PASSWORD" }, performedBy: input.actor.id } });
    throw new BusinessRuleError("كلمة مرور مدير النظام غير صحيحة. تم إلغاء الاستعادة.");
  }
  const data = snapshot.data;
  // JSON snapshots serialize DateTime columns as ISO strings. Rehydrate only fields declared as DateTime in the Prisma schema before any insert runs.
  for (const table of TABLES) data[table] = rehydrateDateRows(table, asRows(data, table));
  // A full relational snapshot legitimately takes longer than an invoice. Keep this bounded below the 90-second route budget so parsing, password checks, and the final response have time to complete.
  const restoreOptions = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 75_000 } as const;
  let restoreStage = "بدء تجهيز قاعدة البيانات";

  try {
    await withTxRetry(() => prisma.$transaction(async (tx) => {
    // Keep the currently authenticated administrator and its permission profile so the restore can never invalidate the in-flight session.
    restoreStage = "تفريغ البيانات التشغيلية الحالية";
    await tx.user.updateMany({ data: { allowedTreasuryIds: [], allowedWarehouseIds: [], transferToTreasuryId: null } });
    await tx.treasuryTransaction.deleteMany(); await tx.treasuryTransfer.deleteMany(); await tx.stockMovement.deleteMany(); await tx.invoiceItem.deleteMany(); await tx.heldSaleItem.deleteMany(); await tx.heldSale.deleteMany(); await tx.invoice.deleteMany(); await tx.treasuryShift.deleteMany(); await tx.installment.deleteMany(); await tx.installmentPlan.deleteMany(); await tx.accountCheck.deleteMany(); await tx.accountBalanceAdjustment.deleteMany(); await tx.customerVehicle.deleteMany(); await tx.importJob.deleteMany(); await tx.partChassis.deleteMany(); await tx.partEngine.deleteMany(); await tx.partItem.deleteMany(); await tx.warehouseBin.deleteMany(); await tx.account.deleteMany(); await tx.treasury.deleteMany(); await tx.category.updateMany({ data: { parentId: null } }); await tx.category.deleteMany(); await tx.brand.deleteMany(); await tx.bmwChassis.deleteMany(); await tx.bmwEngine.deleteMany(); await tx.barcodeConfig.deleteMany(); await tx.documentCounter.deleteMany(); await tx.systemSetting.deleteMany(); await tx.systemAuditTrail.deleteMany();

    restoreStage = "استعادة المستخدمين والصلاحيات";
    const snapshotUsers = asRows(data, "users").filter((row) => row.id !== input.actor.id);
    for (const raw of snapshotUsers) {
      const user: Record<string, unknown> = { ...raw, transferToTreasuryId: null };
      await tx.user.upsert({ where: { id: String(raw.id) }, update: withoutKey(user, "id"), create: user as never });
    }
    await tx.userPermission.deleteMany({ where: { userId: { not: input.actor.id } } });
    const permissions = asRows(data, "userPermissions").filter((row) => row.userId !== input.actor.id);
    if (permissions.length) await tx.userPermission.createMany({ data: permissions as never[] });

    restoreStage = "استعادة البيانات المرجعية والمخازن";
    if (asRows(data, "brands").length) await tx.brand.createMany({ data: asRows(data, "brands") as never[] });
    const categories = asRows(data, "categories");
    if (categories.length) { await tx.category.createMany({ data: categories.map((row) => ({ ...row, parentId: null })) as never[] }); for (const row of categories.filter((item) => item.parentId)) await tx.category.update({ where: { id: String(row.id) }, data: { parentId: String(row.parentId) } }); }
    if (asRows(data, "chassis").length) await tx.bmwChassis.createMany({ data: asRows(data, "chassis") as never[] });
    if (asRows(data, "engines").length) await tx.bmwEngine.createMany({ data: asRows(data, "engines") as never[] });
    if (asRows(data, "warehouseBins").length) await tx.warehouseBin.createMany({ data: asRows(data, "warehouseBins") as never[] });
    restoreStage = "استعادة الحسابات والخزائن وكتالوج الأصناف";
    await insertInChunks(asRows(data, "accounts"), async (chunk) => tx.account.createMany({ data: chunk as never[] }));
    if (asRows(data, "treasuries").length) await tx.treasury.createMany({ data: asRows(data, "treasuries") as never[] });
    await insertInChunks(asRows(data, "parts"), async (chunk) => tx.partItem.createMany({ data: chunk as never[] }));
    if (asRows(data, "partChassis").length) await tx.partChassis.createMany({ data: asRows(data, "partChassis") as never[] });
    if (asRows(data, "partEngines").length) await tx.partEngine.createMany({ data: asRows(data, "partEngines") as never[] });
    if (asRows(data, "customerVehicles").length) await tx.customerVehicle.createMany({ data: asRows(data, "customerVehicles") as never[] });
    restoreStage = "استعادة الفواتير وبنودها";
    await insertInChunks(asRows(data, "invoices"), async (chunk) => tx.invoice.createMany({ data: chunk as never[] }));
    await insertInChunks(asRows(data, "invoiceItems"), async (chunk) => tx.invoiceItem.createMany({ data: chunk as never[] }));
    if (asRows(data, "heldSales").length) await tx.heldSale.createMany({ data: asRows(data, "heldSales") as never[] });
    if (asRows(data, "heldSaleItems").length) await tx.heldSaleItem.createMany({ data: asRows(data, "heldSaleItems") as never[] });
    if (asRows(data, "accountChecks").length) await tx.accountCheck.createMany({ data: asRows(data, "accountChecks") as never[] });
    if (asRows(data, "installmentPlans").length) await tx.installmentPlan.createMany({ data: asRows(data, "installmentPlans") as never[] });
    if (asRows(data, "installments").length) await tx.installment.createMany({ data: asRows(data, "installments") as never[] });
    restoreStage = "استعادة السندات والحركات المالية والمخزنية";
    if (asRows(data, "treasuryShifts").length) await tx.treasuryShift.createMany({ data: asRows(data, "treasuryShifts") as never[] });
    if (asRows(data, "treasuryTransfers").length) await tx.treasuryTransfer.createMany({ data: asRows(data, "treasuryTransfers") as never[] });
    await insertInChunks(asRows(data, "treasuryTransactions"), async (chunk) => tx.treasuryTransaction.createMany({ data: chunk as never[] }));
    const movements = asRows(data, "stockMovements").map((row) => ({ ...row, seq: BigInt(String(row.seq)) }));
    await insertInChunks(movements, async (chunk) => tx.stockMovement.createMany({ data: chunk as never[] }));
    if (asRows(data, "accountBalanceAdjustments").length) await tx.accountBalanceAdjustment.createMany({ data: asRows(data, "accountBalanceAdjustments") as never[] });
    if (asRows(data, "barcodeConfigs").length) await tx.barcodeConfig.createMany({ data: asRows(data, "barcodeConfigs") as never[] });
    if (asRows(data, "importJobs").length) await tx.importJob.createMany({ data: asRows(data, "importJobs") as never[] });
    if (asRows(data, "documentCounters").length) await tx.documentCounter.createMany({ data: asRows(data, "documentCounters") as never[] });
    if (asRows(data, "systemSettings").length) await tx.systemSetting.createMany({ data: asRows(data, "systemSettings") as never[] });
    await insertInChunks(asRows(data, "systemAuditTrail"), async (chunk) => tx.systemAuditTrail.createMany({ data: chunk as never[] }));

    restoreStage = "إعادة ربط المدير وإنهاء التدقيق";
    const restoredActor = asRows(data, "users").find((row) => row.id === input.actor.id);
    if (restoredActor) await tx.user.update({ where: { id: input.actor.id }, data: { allowedTreasuryIds: (restoredActor.allowedTreasuryIds as string[] | undefined) ?? [], allowedWarehouseIds: (restoredActor.allowedWarehouseIds as string[] | undefined) ?? [], transferToTreasuryId: restoredActor.transferToTreasuryId ? String(restoredActor.transferToTreasuryId) : null } });
    for (const row of snapshotUsers.filter((user) => user.transferToTreasuryId)) await tx.user.update({ where: { id: String(row.id) }, data: { transferToTreasuryId: String(row.transferToTreasuryId) } });
    await tx.$executeRawUnsafe('SELECT setval(pg_get_serial_sequence(\'"StockMovement"\', \'seq\'), COALESCE((SELECT MAX(seq) FROM "StockMovement"), 1), EXISTS (SELECT 1 FROM "StockMovement"))');
    await tx.systemAuditTrail.create({ data: { tableName: "System", recordId: "BACKUP_RESTORE", action: "SYSTEM_BACKUP_RESTORED", newData: { restoredBy: input.actor.fullName, backupCreatedAt: snapshot.metadata.createdAt, summary: summary(snapshot) }, performedBy: input.actor.id } });
    }, restoreOptions), 2);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "خطأ غير معروف في قاعدة البيانات";
    throw new BusinessRuleError(`فشلت الاستعادة عند مرحلة «${restoreStage}»: ${detail}`);
  }

  return summary(snapshot);
}

export function backupFileName(createdAt = new Date()) {
  const stamp = createdAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  return `bimmers-backup-${stamp}.json`;
}

export function restoreLimits() {
  return { confirmationPhrase: RESTORE_CONFIRMATION_PHRASE, maxBytes: MAX_RESTORE_BYTES };
}

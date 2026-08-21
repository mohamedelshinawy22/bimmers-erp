import { Prisma, TreasuryType } from "@prisma/client";
import { writeAudit } from "@/lib/audit";

export type ImportPaymentChannel = {
  name: string;
  amount: Prisma.Decimal;
};

export type ResolvedImportTreasury = {
  id: string;
  name: string;
  type: TreasuryType;
  created: boolean;
};

function normalizedTreasuryName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar-EG");
}

function treasuryTypeForChannel(name: string): TreasuryType {
  const token = normalizedTreasuryName(name);
  if (/(بنك|bank|abk)/i.test(token)) return "BANK_ACCOUNT";
  if (/(انستا|insta)/i.test(token)) return "INSTAPAY";
  if (/(فودافون|محفظة|wallet)/i.test(token)) return "WALLET";
  if (/(درج|كاشير|نقد|cash)/i.test(token)) return "CASH_DRAWER";
  return "OTHER";
}

/**
 * Resolves each payment-channel label against active and inactive treasuries by
 * normalized name. A missing label is created within the caller's transaction,
 * so invoice posting and treasury creation commit or roll back together.
 */
export async function resolveOrCreateImportTreasuries(
  tx: Prisma.TransactionClient,
  channelNames: string[],
  userId: string,
): Promise<Map<string, ResolvedImportTreasury>> {
  const labels = [...new Set(channelNames.map((name) => name.trim().replace(/\s+/g, " ")).filter(Boolean))];
  if (!labels.length) return new Map();
  const existing = await tx.treasury.findMany({ select: { id: true, name: true, type: true, isActive: true, notes: true } });
  const byNormalizedName = new Map(existing.map((treasury) => [normalizedTreasuryName(treasury.name), treasury]));
  const resolved = new Map<string, ResolvedImportTreasury>();

  for (const label of labels) {
    const key = normalizedTreasuryName(label);
    let treasury = byNormalizedName.get(key);
    let created = false;
    if (!treasury) {
      try {
        treasury = await tx.treasury.create({ data: { name: label, type: treasuryTypeForChannel(label), currentBalance: new Prisma.Decimal(0), isActive: true, isDefault: false, notes: "أُنشئت تلقائياً من قناة سداد في استيراد Excel" } });
        created = true;
        byNormalizedName.set(key, treasury);
        await writeAudit(tx, { tableName: "Treasury", recordId: treasury.id, action: "INSERT", newData: { ...treasury, source: "INVOICE_EXCEL_CHANNEL_DISCOVERY", channelName: label }, performedBy: userId });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        const concurrent = await tx.treasury.findFirst({ where: { name: { equals: label, mode: "insensitive" } }, select: { id: true, name: true, type: true, isActive: true, notes: true } });
        if (!concurrent) throw error;
        treasury = concurrent;
        byNormalizedName.set(key, treasury);
      }
    }
    if (!treasury.isActive) {
      treasury = await tx.treasury.update({ where: { id: treasury.id }, data: { isActive: true, notes: [treasury.notes, "أُعيد تنشيطها تلقائياً لقناة استيراد Excel"].filter(Boolean).join(" — ") } });
      await writeAudit(tx, { tableName: "Treasury", recordId: treasury.id, action: "UPDATE", newData: { ...treasury, source: "INVOICE_EXCEL_CHANNEL_DISCOVERY_REACTIVATE" }, performedBy: userId });
    }
    resolved.set(label, { id: treasury.id, name: treasury.name, type: treasury.type, created });
  }
  return resolved;
}

export function classifyImportPaymentChannel(name: string): TreasuryType {
  return treasuryTypeForChannel(name);
}

export function normalizeImportPaymentChannelName(name: string) {
  return normalizedTreasuryName(name);
}

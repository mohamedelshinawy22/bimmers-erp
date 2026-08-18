import { z } from "zod";

const uuid = z.string().uuid("معرّف غير صالح");
const amount = z.coerce.number().finite().positive("يجب أن يكون المبلغ أكبر من صفر").max(99_999_999);
const openingBalance = z.coerce.number().finite("رصيد الافتتاح يجب أن يكون رقماً صحيحاً").min(0, "رصيد الافتتاح لا يمكن أن يكون سالباً").max(99_999_999);
const optionalText = z.string().trim().max(500).optional().transform((value) => value || undefined);
const treasuryType = z.enum(["CASH_DRAWER", "BANK_ACCOUNT", "POS_TERMINAL", "WALLET", "INSTAPAY", "OTHER"]);

export const treasurySchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: treasuryType,
  notes: optionalText,
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const createTreasurySchema = treasurySchema.extend({
  openingBalance: openingBalance.default(0),
});

export const treasuryTransferV2Schema = z.object({
  fromTreasuryId: uuid,
  toTreasuryId: uuid,
  amount,
  notes: optionalText,
}).refine((input) => input.fromTreasuryId !== input.toTreasuryId, { message: "لا يمكن التحويل إلى الخزينة نفسها.", path: ["toTreasuryId"] });

export const treasuryReportSchema = z.object({
  treasuryIds: z.array(uuid).max(50).default([]),
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  searchQuery: z.string().trim().max(100).optional(),
}).refine((input) => input.fromDate < input.toDate, { message: "يجب أن يكون تاريخ البداية قبل النهاية.", path: ["toDate"] });

export type TreasuryInput = z.infer<typeof treasurySchema>;
export type CreateTreasuryInput = z.infer<typeof createTreasurySchema>;
export type TreasuryReportInput = z.infer<typeof treasuryReportSchema>;
export type TreasuryTransferV2Input = z.infer<typeof treasuryTransferV2Schema>;

import { z } from "zod";

const uuid = z.string().uuid("معرّف غير صالح");

export const dailyMovementReportSchema = z.object({
  fromDate: z.coerce.date(),
  toDate: z.coerce.date(),
  operatorId: z.string().trim().uuid("المستخدم المحدد غير صالح").optional().or(z.literal("")),
  warehouseName: z.string().trim().max(120).optional().or(z.literal("")),
  treasuryIds: z.array(uuid).max(50).default([]),
}).refine((input) => input.fromDate < input.toDate, {
  message: "يجب أن يكون تاريخ البداية قبل النهاية.",
  path: ["toDate"],
});

export type DailyMovementReportInput = z.infer<typeof dailyMovementReportSchema>;

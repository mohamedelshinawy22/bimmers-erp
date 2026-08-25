import { z } from "zod";
import { nonNegativeMoney, optionalText, optionalUuid, positiveInt, positiveMoney, uuid } from "./common";

export const invoiceLineSchema = z.object({
  partId: uuid,
  quantity: positiveInt.pipe(z.number().max(100_000, "الكمية كبيرة جداً")),
  unitPrice: nonNegativeMoney,
  /** Per-line discount, absolute value in currency. */
  lineDiscount: nonNegativeMoney.default(0),
});

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;

const baseInvoice = {
  accountId: uuid,
  treasuryId: optionalUuid,
  vehicleId: optionalUuid,
  discountAmount: nonNegativeMoney.default(0),
  /**
   * Advisory only. The server recomputes tax from TAX_RATE_PERCENT and ignores
   * this value — it is accepted so existing clients don't break, and validated
   * so a hostile value can't reach the transaction.
   */
  taxAmount: nonNegativeMoney.default(0),
  paidAmount: nonNegativeMoney.default(0),
  /**
   * "Settle the invoice in full." When set, the server uses its own computed
   * grandTotal as the paid amount, so a client-side rounding difference can
   * never leave a one-piastre phantom receivable.
   */
  payFull: z.boolean().default(false),
  notes: optionalText(1000),
  items: z.array(invoiceLineSchema).min(1, "يجب إضافة صنف واحد على الأقل").max(300, "عدد الأصناف كبير جداً"),
};

export const createSaleInvoiceSchema = z
  .object({
    ...baseInvoice,
    paymentMethod: z.enum(["CASH", "VISA", "SPLIT", "ON_ACCOUNT"]),
    /** Manager override to sell below sellPriceMin. Server re-checks the role. */
    allowBelowMinPrice: z.boolean().default(false),
    /** Manager override to exceed MAX_INVOICE_DISCOUNT_PERCENT. Server re-checks. */
    allowDiscountOverride: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    // Structural checks only. Monetary authority lives in the service, which
    // recomputes every figure from `items` — this schema cannot know the tax
    // rate or the discount cap, so it must not pretend to validate totals.
    if (data.paymentMethod === "ON_ACCOUNT" && (data.paidAmount > 0 || data.payFull)) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentMethod"],
        message: "لا يمكن تحصيل مبلغ نقدي في فاتورة على الحساب",
      });
    }
    if (data.paymentMethod !== "ON_ACCOUNT" && (data.paidAmount > 0 || data.payFull) && !data.treasuryId) {
      ctx.addIssue({
        code: "custom",
        path: ["treasuryId"],
        message: "يجب تحديد الخزينة لتحصيل المبلغ",
      });
    }
    for (const [index, item] of data.items.entries()) {
      if (item.lineDiscount > item.quantity * item.unitPrice) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "lineDiscount"],
          message: "خصم السطر أكبر من قيمة السطر",
        });
      }
    }
  });

export type CreateSaleInvoiceInput = z.infer<typeof createSaleInvoiceSchema>;

export const createPurchaseInvoiceSchema = z
  .object({
    ...baseInvoice,
    paymentMethod: z.enum(["CASH", "VISA", "ON_ACCOUNT"]),
  })
  .superRefine((data, ctx) => {
    if ((data.paidAmount > 0 || data.payFull) && !data.treasuryId) {
      ctx.addIssue({
        code: "custom",
        path: ["treasuryId"],
        message: "يجب تحديد الخزينة لصرف المبلغ",
      });
    }
    for (const [index, item] of data.items.entries()) {
      if (item.lineDiscount > item.quantity * item.unitPrice) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "lineDiscount"],
          message: "خصم السطر أكبر من قيمة السطر",
        });
      }
    }
  });

export type CreatePurchaseInvoiceInput = z.infer<typeof createPurchaseInvoiceSchema>;

export const updateSaleInvoiceSchema = createSaleInvoiceSchema.extend({ invoiceId: uuid });
export type UpdateSaleInvoiceInput = z.infer<typeof updateSaleInvoiceSchema>;

export const updatePurchaseInvoiceSchema = createPurchaseInvoiceSchema.extend({ invoiceId: uuid });
export type UpdatePurchaseInvoiceInput = z.infer<typeof updatePurchaseInvoiceSchema>;

export const voidInvoiceSchema = z.object({
  invoiceId: uuid,
  reason: z.string().trim().min(5, "يجب كتابة سبب الإلغاء بشكل واضح").max(500),
});

export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;

export const settleInvoiceSchema = z.object({
  invoiceId: uuid,
  treasuryId: uuid,
  amount: positiveMoney,
  description: optionalText(500),
});

export type SettleInvoiceInput = z.infer<typeof settleInvoiceSchema>;

export const invoiceReturnLineSchema = z.object({
  invoiceItemId: uuid,
  quantity: positiveInt.pipe(z.number().max(100_000, "الكمية كبيرة جداً")),
});

export const createInvoiceReturnSchema = z.object({
  originalInvoiceId: uuid,
  treasuryId: optionalUuid,
  paidAmount: nonNegativeMoney.default(0),
  notes: optionalText(500),
  items: z.array(invoiceReturnLineSchema).min(1, "اختر صنفاً واحداً على الأقل للمرتجع").max(300),
}).superRefine((data, ctx) => {
  if (data.paidAmount > 0 && !data.treasuryId) ctx.addIssue({ code: "custom", path: ["treasuryId"], message: "يجب تحديد الخزينة لرد أو استلام المبلغ" });
});

export type CreateInvoiceReturnInput = z.infer<typeof createInvoiceReturnSchema>;

export const treasuryTransactionSchema = z.object({
  treasuryId: uuid,
  accountId: optionalUuid,
  invoiceId: optionalUuid,
  type: z.enum(["RECEIPT", "PAYMENT"]),
  amount: positiveMoney,
  /** Stored on the voucher as its payment channel; the financial sign is determined solely by type. */
  category: z.enum(["CASH", "BANK", "WALLET", "CHEQUE", "INSTAPAY", "OTHER"]).optional(),
  /** Optional business timestamp for an authorised, manually entered voucher. */
  createdAt: z.string().datetime().optional(),
  description: optionalText(500),
});

export type TreasuryTransactionInput = z.infer<typeof treasuryTransactionSchema>;

export const treasuryTransferSchema = z
  .object({
    fromTreasuryId: uuid,
    toTreasuryId: uuid,
    amount: positiveMoney,
    description: z.string().trim().min(3).max(500),
  })
  .refine((d) => d.fromTreasuryId !== d.toTreasuryId, {
    path: ["toTreasuryId"],
    message: "لا يمكن التحويل إلى نفس الخزينة",
  });

export type TreasuryTransferInput = z.infer<typeof treasuryTransferSchema>;

export const openShiftSchema = z.object({
  treasuryId: uuid,
  openingBalance: nonNegativeMoney,
  notes: optionalText(500),
});

export const closeShiftSchema = z.object({
  shiftId: uuid,
  countedCash: nonNegativeMoney,
  notes: optionalText(500),
});

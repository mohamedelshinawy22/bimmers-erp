-- Link standalone return documents to their original invoice for traceability and return-quantity controls.
ALTER TABLE "Invoice" ADD COLUMN "returnOfId" TEXT;

CREATE INDEX "Invoice_returnOfId_idx" ON "Invoice"("returnOfId");

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_returnOfId_fkey"
  FOREIGN KEY ("returnOfId") REFERENCES "Invoice"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { toActionError } from "./action-result";

describe("action result error containment", () => {
  it("converts a closed Prisma transaction into a serializable Arabic failure result", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Transaction already closed", { code: "P2028", clientVersion: "5.19.1" });
    expect(toActionError(error, "catalog-import-test")).toEqual({ success: false, error: "انتهت مهلة العملية بسبب تزاحم على نفس الأصناف. أعد المحاولة." });
  });
});

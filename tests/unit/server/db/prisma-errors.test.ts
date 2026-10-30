import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "@/server/errors";
import { translatePrismaError } from "@/server/db/prisma-errors";

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("database error", {
    code,
    clientVersion: "test",
  });
}

describe("translatePrismaError", () => {
  it.each([
    ["P2002", ConflictError],
    ["P2003", NotFoundError],
    ["P2025", NotFoundError],
    ["P2034", ConflictError],
  ] as const)("translates %s when the caller lists it", (code, expected) => {
    expect(translatePrismaError(prismaError(code), [code])).toBeInstanceOf(expected);
  });

  it("leaves codes the caller did not list untranslated", () => {
    expect(translatePrismaError(prismaError("P2002"), ["P2025"])).toBeUndefined();
    expect(translatePrismaError(prismaError("P9999"), ["P2002", "P2025"])).toBeUndefined();
  });

  it("ignores errors that are not known Prisma request errors", () => {
    expect(translatePrismaError(new Error("P2002"), ["P2002"])).toBeUndefined();
    expect(translatePrismaError("P2002", ["P2002"])).toBeUndefined();
  });
});

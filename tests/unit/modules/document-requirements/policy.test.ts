import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_DOCUMENT_REQUIREMENTS,
  assertCanAddActiveRequirement,
  nextRequirementPosition,
  planRequirementMove,
} from "@/modules/document-requirements/domain/requirement-order";
import { ConflictError, ValidationError, toErrorResponse } from "@/server/errors";
import { validateInput } from "@/server/validation";
import { documentRequirementInputSchema, documentRequirementMoveSchema } from "@/modules/document-requirements/application/document-requirement-schemas";

function validRequirement(overrides: Record<string, unknown> = {}) {
  return {
    name: "Requerimento de férias",
    isRequired: true,
    acceptedFormats: ["PDF"],
    ...overrides,
  };
}

function parse(input: unknown) {
  return validateInput(documentRequirementInputSchema, input);
}

describe("document requirement input validation", () => {
  it("accepts a trimmed name, the required flag and a subset of PDF, DOCX and TXT", () => {
    expect(
      parse(validRequirement({ name: "  Documento de autorização  ", acceptedFormats: ["TXT", "DOCX"] })),
    ).toEqual({
      name: "Documento de autorização",
      isRequired: true,
      acceptedFormats: ["TXT", "DOCX"],
    });
    expect(parse(validRequirement({ isRequired: false, acceptedFormats: ["PDF", "DOCX", "TXT"] })))
      .toMatchObject({ isRequired: false });
  });

  it("accepts 120 characters and rejects 121 after trimming", () => {
    expect(parse(validRequirement({ name: ` ${"a".repeat(120)} ` })).name).toHaveLength(120);
    expect(() => parse(validRequirement({ name: "a".repeat(121) }))).toThrow(ValidationError);
  });

  it.each([
    ["an empty name", { name: "" }],
    ["a whitespace-only name", { name: "   " }],
    ["no formats", { acceptedFormats: [] }],
    ["an unsupported format", { acceptedFormats: ["EXE"] }],
    ["lower-case formats", { acceptedFormats: ["pdf"] }],
    ["repeated formats", { acceptedFormats: ["PDF", "PDF"] }],
    ["a non-boolean required flag", { isRequired: "yes" }],
    ["a forged service", { serviceId: "6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4" }],
    ["a forged position", { position: 0 }],
    ["a forged state", { isActive: false }],
  ])("rejects %s (CA-DOC-02)", (_label, overrides) => {
    expect(() => parse(validRequirement(overrides))).toThrow(ValidationError);
  });

  it("exposes only safe validation paths", () => {
    let error: unknown;

    try {
      parse({ name: "", isRequired: "x", acceptedFormats: [] });
    } catch (caught) {
      error = caught;
    }

    const paths = toErrorResponse(error).body.error.issues?.map((issue) => issue.path[0]);

    expect(paths).toEqual(expect.arrayContaining(["name", "isRequired", "acceptedFormats"]));
  });

  it("accepts only up and down as move directions", () => {
    expect(validateInput(documentRequirementMoveSchema, "up")).toBe("up");
    expect(validateInput(documentRequirementMoveSchema, "down")).toBe("down");
    expect(() => validateInput(documentRequirementMoveSchema, "top")).toThrow(ValidationError);
  });
});

describe("active requirement limit", () => {
  it("allows up to five active requirements per service", () => {
    expect(MAX_ACTIVE_DOCUMENT_REQUIREMENTS).toBe(5);

    for (let count = 0; count < 5; count += 1) {
      expect(() => assertCanAddActiveRequirement(count)).not.toThrow();
    }

    expect(() => assertCanAddActiveRequirement(5)).toThrow(ConflictError);
  });

  it("places new requirements after every existing one, active or not", () => {
    expect(nextRequirementPosition([])).toBe(0);
    expect(nextRequirementPosition([{ id: "a", position: 0 }, { id: "b", position: 7 }])).toBe(8);
  });
});

describe("requirement reordering", () => {
  const requirements = [
    { id: "c", position: 2 },
    { id: "a", position: 0 },
    { id: "b", position: 1 },
  ];

  it("swaps a requirement with its neighbour", () => {
    expect(planRequirementMove(requirements, "b", "up")).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
    expect(planRequirementMove(requirements, "b", "down")).toEqual([
      { id: "c", position: 1 },
      { id: "b", position: 2 },
    ]);
  });

  it("has no effect when moving the first up or the last down", () => {
    expect(planRequirementMove(requirements, "a", "up")).toEqual([]);
    expect(planRequirementMove(requirements, "c", "down")).toEqual([]);
  });

  it("renumbers gaps and ties so the order stays deterministic", () => {
    expect(
      planRequirementMove(
        [
          { id: "a", position: 4 },
          { id: "b", position: 4 },
          { id: "c", position: 9 },
        ],
        "c",
        "up",
      ),
    ).toEqual([
      { id: "a", position: 0 },
      { id: "c", position: 1 },
      { id: "b", position: 2 },
    ]);
  });

  it("refuses requirements outside the active list of the service (CA-DOC-03)", () => {
    expect(() => planRequirementMove(requirements, "other-service-requirement", "up")).toThrow(
      ConflictError,
    );
  });
});

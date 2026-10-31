import { describe, expect, it } from "vitest";
import { ValidationError } from "@/server/errors";
import {
  assertFormatStillAccepted,
  matchAttachmentsToRequirements,
  type ActiveDocumentRequirement,
} from "@/modules/requests/domain/attachment-requirements";

const required: ActiveDocumentRequirement = {
  id: "requirement-required",
  name: "Request form",
  isRequired: true,
  acceptedFormats: ["PDF"],
};
const optional: ActiveDocumentRequirement = {
  id: "requirement-optional",
  name: "Supporting file",
  isRequired: false,
  acceptedFormats: ["PDF", "TXT"],
};

function rejection(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as ValidationError).issues;
  }
  throw new Error("Expected a validation error.");
}

describe("attachment and requirement matching (SPEC 21.4)", () => {
  it("pairs each file with its requirement when every required one is covered", () => {
    const matches = matchAttachmentsToRequirements(
      [required, optional],
      [{ requirementId: required.id }],
    );

    expect(matches).toEqual([{ attachment: { requirementId: required.id }, requirement: required }]);
  });

  it("accepts no files for a service without active requirements (CA-DOC-05)", () => {
    expect(matchAttachmentsToRequirements([], [])).toEqual([]);
  });

  it("rejects any file for a service without active requirements (CA-DOC-05)", () => {
    expect(rejection(() => matchAttachmentsToRequirements([], [{ requirementId: required.id }]))).toEqual([
      { path: ["attachments"], code: "invalid_value" },
    ]);
  });

  it("rejects a missing required file (CA-DOC-07)", () => {
    expect(
      rejection(() => matchAttachmentsToRequirements([required, optional], [{ requirementId: optional.id }])),
    ).toEqual([{ path: ["attachments"], code: "too_small" }]);
  });

  it("rejects unknown, inactive or foreign requirements and duplicates (CA-DOC-08)", () => {
    for (const attachments of [
      [{ requirementId: "requirement-of-another-service" }],
      [{ requirementId: required.id }, { requirementId: required.id }],
    ]) {
      expect(rejection(() => matchAttachmentsToRequirements([required], attachments))).toEqual([
        { path: ["attachments"], code: "invalid_value" },
      ]);
    }
  });

  it("rejects a detected format the requirement no longer accepts", () => {
    expect(() => assertFormatStillAccepted(optional, "TXT")).not.toThrow();
    expect(rejection(() => assertFormatStillAccepted(required, "TXT"))).toEqual([
      { path: ["attachments"], code: "invalid_format" },
    ]);
  });
});

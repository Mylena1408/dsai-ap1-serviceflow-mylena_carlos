import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError } from "@/server/errors";
import {
  assertServiceCanReceiveRequests,
  assertServiceRelationships,
} from "@/modules/services/domain/relationships";

describe("service availability policy", () => {
  const activeRelations = {
    categoryExists: true,
    categoryActive: true,
    sectorExists: true,
    sectorActive: true,
  };

  it("requires both related records to exist", () => {
    expect(() =>
      assertServiceRelationships(
        { ...activeRelations, categoryExists: false },
        false,
      ),
    ).toThrow(NotFoundError);
    expect(() =>
      assertServiceRelationships(
        { ...activeRelations, sectorExists: false },
        false,
      ),
    ).toThrow(NotFoundError);
  });

  it("requires both relationships to be active whenever a service is active", () => {
    expect(() =>
      assertServiceRelationships(activeRelations, true),
    ).not.toThrow();
    expect(() =>
      assertServiceRelationships(
        { ...activeRelations, categoryActive: false },
        true,
      ),
    ).toThrow(ConflictError);
    expect(() =>
      assertServiceRelationships(
        { ...activeRelations, sectorActive: false },
        true,
      ),
    ).toThrow(ConflictError);
    expect(() =>
      assertServiceRelationships(
        { ...activeRelations, categoryActive: false, sectorActive: false },
        false,
      ),
    ).not.toThrow();
  });

  it("rejects requests for an inactive service or inactive related records", () => {
    expect(() =>
      assertServiceCanReceiveRequests({
        isActive: false,
        categoryActive: true,
        sectorActive: true,
      }),
    ).toThrow(NotFoundError);
    expect(() =>
      assertServiceCanReceiveRequests({
        isActive: true,
        categoryActive: false,
        sectorActive: true,
      }),
    ).toThrow(ConflictError);
    expect(() =>
      assertServiceCanReceiveRequests({
        isActive: true,
        categoryActive: true,
        sectorActive: false,
      }),
    ).toThrow(ConflictError);
  });
});

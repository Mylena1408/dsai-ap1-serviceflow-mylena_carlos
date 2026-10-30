import { describe, expect, it } from "vitest";
import { buildRequestSnapshot } from "@/modules/requests/domain/snapshot";
import { assertRequestStatusTransition } from "@/modules/requests/domain/status-transition";

describe("request snapshot construction", () => {
  it("copies current service/category/sector data and trusts the supplied server actor ID", () => {
    expect(
      buildRequestSnapshot("session-requester", {
        id: "service-id",
        name: "Current service",
        description: "Current description",
        category: { id: "category-id", name: "Current category" },
        sector: { id: "sector-id", name: "Current sector" },
      }),
    ).toEqual({
      requesterId: "session-requester",
      serviceId: "service-id",
      sectorId: "sector-id",
      serviceNameSnapshot: "Current service",
      serviceDescriptionSnapshot: "Current description",
      categoryIdSnapshot: "category-id",
      categoryNameSnapshot: "Current category",
      sectorNameSnapshot: "Current sector",
    });
  });

  describe("request status transition policy", () => {
    it.each([
      ["OPEN", "IN_PROGRESS"],
      ["IN_PROGRESS", "COMPLETED"],
    ] as const)("allows %s to %s", (fromStatus, toStatus) => {
      expect(() =>
        assertRequestStatusTransition(fromStatus, toStatus),
      ).not.toThrow();
    });

    it.each([
      ["OPEN", "OPEN"],
      ["OPEN", "COMPLETED"],
      ["IN_PROGRESS", "OPEN"],
      ["IN_PROGRESS", "IN_PROGRESS"],
      ["COMPLETED", "OPEN"],
      ["COMPLETED", "IN_PROGRESS"],
      ["COMPLETED", "COMPLETED"],
    ] as const)("rejects %s to %s", (fromStatus, toStatus) => {
      expect(() =>
        assertRequestStatusTransition(fromStatus, toStatus),
      ).toThrow("The request conflicts with the current state.");
    });
  });
});

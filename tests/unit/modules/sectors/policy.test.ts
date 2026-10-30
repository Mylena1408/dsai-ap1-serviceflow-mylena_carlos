import { describe, expect, it } from "vitest";
import { ConflictError } from "@/server/errors";
import { assertSectorCanBeDeactivated } from "@/modules/sectors/domain/deactivation";

describe("sector deactivation policy", () => {
  it("allows deactivation only when no active user, service, or pending request depends on it", () => {
    expect(() =>
      assertSectorCanBeDeactivated({
        hasActiveService: false,
        hasPendingRequest: false,
        hasActiveAttendant: false,
      }),
    ).not.toThrow();
  });

  it.each([
    { hasActiveService: true, hasPendingRequest: false, hasActiveAttendant: false },
    { hasActiveService: false, hasPendingRequest: true, hasActiveAttendant: false },
    { hasActiveService: true, hasPendingRequest: true, hasActiveAttendant: false },
    { hasActiveService: false, hasPendingRequest: false, hasActiveAttendant: true },
  ])("rejects deactivation when dependencies remain: %o", (dependencies) => {
    expect(() => assertSectorCanBeDeactivated(dependencies)).toThrow(ConflictError);
  });
});

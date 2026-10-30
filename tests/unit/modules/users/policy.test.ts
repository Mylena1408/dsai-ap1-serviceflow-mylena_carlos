import { describe, expect, it } from "vitest";
import { ConflictError } from "@/server/errors";
import {
  assertAdministratorCanRetire,
  assertAttendantCanLeaveSector,
} from "@/modules/users/domain/user-rules";

describe("user administration policy", () => {
  it("prevents retirement of the last active administrator", () => {
    expect(() =>
      assertAdministratorCanRetire({
        isActiveAdministrator: true,
        activeAdministratorCount: 1,
        remainsActiveAdministrator: false,
      }),
    ).toThrow(ConflictError);
    expect(() =>
      assertAdministratorCanRetire({
        isActiveAdministrator: true,
        activeAdministratorCount: 2,
        remainsActiveAdministrator: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertAdministratorCanRetire({
        isActiveAdministrator: false,
        activeAdministratorCount: 0,
        remainsActiveAdministrator: false,
      }),
    ).not.toThrow();
  });

  it("protects the last active attendant for pending work when leaving a sector", () => {
    const base = {
      isActiveAttendant: true,
      currentSectorId: "sector-1",
      nextRole: "REQUESTER" as const,
      nextSectorId: null,
      nextIsActive: true,
      hasPendingRequests: true,
      otherActiveAttendantCount: 0,
    };

    expect(() => assertAttendantCanLeaveSector(base)).toThrow(ConflictError);
    expect(() =>
      assertAttendantCanLeaveSector({
        ...base,
        otherActiveAttendantCount: 1,
      }),
    ).not.toThrow();
    expect(() =>
      assertAttendantCanLeaveSector({
        ...base,
        hasPendingRequests: false,
      }),
    ).not.toThrow();
  });
});

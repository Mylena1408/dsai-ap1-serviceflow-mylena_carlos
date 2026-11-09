import { describe, expect, it } from "vitest";
import type { RequestLinkView } from "@/modules/requests";
import { duplicateOriginal } from "@/app/(attendant)/queue/[requestId]/duplicate-original";

// SPEC 2026-11-08-atendimento-dia-a-dia, 8.3 item 1 (SF-219; CA-DUP-01).

const link = (role: RequestLinkView["role"], status: RequestLinkView["other"]["status"] = "OPEN"): RequestLinkView => ({
  id: `${role}-${status}`,
  role,
  other: { id: "ab12cd34-0000-4000-8000-000000000000", serviceName: "Cadeira", sectorName: "Central", status, readable: true },
});

describe("when the attendant may close as a duplicate", () => {
  it("only on a request linked as a duplicate of an original that is not cancelled", () => {
    expect(duplicateOriginal([link("related"), link("duplicate_of", "IN_PROGRESS")])).toMatchObject({ serviceName: "Cadeira", status: "IN_PROGRESS" });
    expect(duplicateOriginal([link("duplicate_of", "COMPLETED")])).toMatchObject({ status: "COMPLETED" });
  });

  it("not without the link, from the original's side, nor with a cancelled original", () => {
    expect(duplicateOriginal([])).toBeNull();
    expect(duplicateOriginal([link("related"), link("original_of")])).toBeNull();
    expect(duplicateOriginal([link("duplicate_of", "CANCELLED")])).toBeNull();
  });
});

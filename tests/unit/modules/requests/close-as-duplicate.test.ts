import { describe, expect, it } from "vitest";
import { duplicateNote } from "@/modules/requests/application/lifecycle-actions";
import { linkEventTitle } from "@/app/_components/request-timeline";

// SPEC 2026-11-08-atendimento-dia-a-dia, 8.3 item 2 (SF-217).

const original = "ab12cd34-0000-4000-8000-000000000000";
const duplicate = "ef56ab78-0000-4000-8000-000000000000";

describe("closing as a duplicate, in words", () => {
  it("writes the cancellation's reason with the original's code and the attendant's note", () => {
    expect(duplicateNote("AB12CD34", "Mesmo pedido.")).toBe("Duplicada de #AB12CD34. Mesmo pedido.");
    expect(duplicateNote("AB12CD34", null)).toBe("Duplicada de #AB12CD34.");
  });

  it("names the closing on each side of the link", () => {
    expect(linkEventTitle({ role: "duplicate_of", action: "CLOSED_AS_DUPLICATE", otherRequestId: original })).toBe("Encerrada como duplicada de #AB12CD34");
    expect(linkEventTitle({ role: "original_of", action: "CLOSED_AS_DUPLICATE", otherRequestId: duplicate })).toBe("Duplicada #EF56AB78 encerrada");
    // The other actions read as before.
    expect(linkEventTitle({ role: "duplicate_of", action: "LINKED", otherRequestId: original })).toBe("Vinculada como duplicada de #AB12CD34");
    expect(linkEventTitle({ role: "related", action: "UNLINKED", otherRequestId: original })).toBe("Vínculo removido: relacionada a #AB12CD34");
  });
});

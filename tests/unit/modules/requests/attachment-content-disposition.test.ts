import { describe, expect, it } from "vitest";
import { buildAttachmentContentDisposition } from "@/modules/requests/domain/attachment";

describe("attachment Content-Disposition (SPEC 21.5 item 5)", () => {
  it("always forces a download with an ASCII name and the UTF-8 name", () => {
    expect(buildAttachmentContentDisposition("form.pdf")).toBe(
      "attachment; filename=\"form.pdf\"; filename*=UTF-8''form.pdf",
    );
    expect(buildAttachmentContentDisposition("Férias 2026.pdf")).toBe(
      "attachment; filename=\"F_rias 2026.pdf\"; filename*=UTF-8''F%C3%A9rias%202026.pdf",
    );
  });

  it("cannot break out of the header value", () => {
    const header = buildAttachmentContentDisposition("a\"; filename=evil.html; x=\\%.txt");

    expect(header).toBe(
      "attachment; filename=\"a__ filename=evil.html_ x=__.txt\"; " +
        "filename*=UTF-8''a%22%3B%20filename%3Devil.html%3B%20x%3D%5C%25.txt",
    );
    expect(header.split(";")).toHaveLength(3);
  });
});

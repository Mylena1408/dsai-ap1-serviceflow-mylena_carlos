import { describe, expect, it } from "vitest";
import { commentFiles, isEmptyFileInput } from "@/app/_components/comment-form-data";

// SPEC 2026-11-03-anexos-comentarios-documentos, 5.1 (SF-125): a file input left empty is not a file.

describe("empty file inputs", () => {
  it("skips the empty input as browsers and Next.js deliver it, and keeps real files, even empty ones", async () => {
    expect(isEmptyFileInput(new File([], ""))).toBe(true);
    expect(isEmptyFileInput(new File([], "undefined"))).toBe(true);
    // Node 24 delivers the empty input as "blob" (CI of 2026-11-06).
    expect(isEmptyFileInput(new File([], "blob"))).toBe(true);
    expect(isEmptyFileInput(new File(["%PDF"], "blob"))).toBe(false);
    expect(isEmptyFileInput(new File([], "vazio.txt"))).toBe(false);
    expect(isEmptyFileInput(new File(["oi"], "undefined"))).toBe(false);

    const form = new FormData();
    form.append("files", new File([], "undefined", { type: "application/octet-stream" }));
    form.append("files", new File(["conteúdo"], "nota.txt"));
    form.append("files", "texto solto");
    const files = await commentFiles(form);
    expect(files.map(({ name, bytes }) => [name, bytes.length])).toEqual([["nota.txt", 9]]);
  });
});

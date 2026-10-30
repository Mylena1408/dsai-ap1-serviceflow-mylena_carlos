import { describe, expect, it } from "vitest";
import { ConflictError } from "@/server/errors";
import { assertCategoryCanBeDeactivated } from "@/modules/categories/domain/deactivation";

describe("category deactivation policy", () => {
  it("allows deactivation without active services", () => {
    expect(() => assertCategoryCanBeDeactivated(false)).not.toThrow();
  });

  it("rejects deactivation while an active service uses the category", () => {
    expect(() => assertCategoryCanBeDeactivated(true)).toThrow(ConflictError);
  });
});

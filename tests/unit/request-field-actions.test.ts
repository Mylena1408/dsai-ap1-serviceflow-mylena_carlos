import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/server/errors";

// SPEC 2026-11-01-campos-personalizados, sections 5.3.3 and 5.3.4 (SF-073): the opening action
// sends the answers and returns refusals as field ids and fixed codes, never the typed values.

const requests = vi.hoisted(() => ({ createRequest: vi.fn() }));
const nextNavigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/modules/requests", () => requests);
vi.mock("@/modules/comments", () => ({ addComment: vi.fn() }));
vi.mock("@/modules/service-fields", async () => {
  const { FieldAnswersError } = await import("@/modules/service-fields/domain/field-value");
  return { FieldAnswersError };
});
vi.mock("next/navigation", () => nextNavigation);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { FieldAnswersError } from "@/modules/service-fields/domain/field-value";
import { createRequestAction } from "@/app/(requester)/requests/actions";

const assetId = "55555555-5555-4555-8555-555555555551";
const shiftId = "55555555-5555-4555-8555-555555555552";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("opening action with custom fields (SF-073)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.createRequest.mockResolvedValue({ id: "request-id" });
  });

  it("sends the answers named field.<id> and nothing else as field values", async () => {
    await expect(
      createRequestAction(
        form({
          serviceId: "service-id",
          description: "Troca de lâmpada",
          [`field.${assetId}`]: "PAT-0042",
          [`field.${shiftId}`]: "",
          fieldValues: "forged",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/requests/request-id?notice=created");

    expect(requests.createRequest).toHaveBeenCalledWith({
      serviceId: "service-id",
      description: "Troca de lâmpada",
      attachments: [],
      fieldValues: { [assetId]: "PAT-0042", [shiftId]: "" },
    });
  });

  it("returns invalid answers as field ids and codes, without the typed values", async () => {
    requests.createRequest.mockRejectedValueOnce(
      new FieldAnswersError("invalid", [
        { fieldId: assetId, code: "required" },
        { fieldId: shiftId, code: "invalid_option" },
      ]),
    );

    const error = await createRequestAction(
      form({ serviceId: "service-id", description: "segredo digitado", [`field.${shiftId}`]: "Noite" }),
    ).catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    const path = (error as Error).message;
    expect(path).toBe(
      `REDIRECT:/catalog/service-id?error=fields&fields=${encodeURIComponent(`${assetId}.required,${shiftId}.invalid_option`)}`,
    );
    expect(path).not.toContain("Noite");
    expect(path).not.toContain("segredo");
  });

  it("asks for a reload when the form was built with another configuration", async () => {
    requests.createRequest.mockRejectedValueOnce(new FieldAnswersError("stale_form"));

    await expect(createRequestAction(form({ serviceId: "service-id", description: "x" }))).rejects.toThrow(
      "REDIRECT:/catalog/service-id?error=fields-changed",
    );
  });

  it("keeps the previous error codes for other refusals", async () => {
    requests.createRequest.mockRejectedValueOnce(new ValidationError([{ path: ["description"], code: "too_small" }]));

    await expect(
      createRequestAction(form({ serviceId: "service-id", description: "", [`field.${assetId}`]: "1" })),
    ).rejects.toThrow("REDIRECT:/catalog/service-id?error=validation");
  });
});

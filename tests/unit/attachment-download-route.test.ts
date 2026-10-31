import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/server/errors";
import { DocumentStorageError } from "@/server/storage";

const requests = vi.hoisted(() => ({
  getAttachmentDownload: vi.fn(),
}));

vi.mock("@/modules/requests", async () => {
  const { buildAttachmentContentDisposition } = await import("@/modules/requests/domain/attachment");
  return { ...requests, buildAttachmentContentDisposition };
});

import { GET } from "@/app/api/requests/[requestId]/attachments/[attachmentId]/route";

const requestId = "55555555-5555-4555-8555-555555555551";
const attachmentId = "66666666-6666-4666-8666-666666666661";

function call(params = { requestId, attachmentId }) {
  return GET(new Request(`http://localhost/api/requests/${requestId}/attachments/${attachmentId}`), {
    params: Promise.resolve(params),
  });
}

describe("attachment download route (SPEC 21.5, 21.15.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the content with the required headers (CA-DOC-18)", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 synthetic");
    requests.getAttachmentDownload.mockResolvedValue({
      filename: "form.pdf",
      contentType: "application/pdf",
      bytes,
    });

    const response = await call();

    expect(requests.getAttachmentDownload).toHaveBeenCalledWith(requestId, attachmentId);
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "application/pdf",
      "content-length": String(bytes.length),
      "content-disposition": "attachment; filename=\"form.pdf\"; filename*=UTF-8''form.pdf",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("answers every denial exactly like a missing attachment (CA-DOC-16)", async () => {
    const responses = [];

    for (const error of [
      new NotFoundError(),
      new AuthenticationError(),
      new AuthorizationError(),
      new ValidationError([{ path: ["requestId"], code: "invalid_format" }]),
    ]) {
      requests.getAttachmentDownload.mockRejectedValueOnce(error);
      const response = await call();
      responses.push({
        status: response.status,
        body: await response.text(),
        cache: response.headers.get("cache-control"),
      });
    }

    expect(new Set(responses.map((response) => JSON.stringify(response))).size).toBe(1);
    expect(responses[0]).toEqual({
      status: 404,
      body: JSON.stringify({
        error: { code: "NOT_FOUND", message: "The requested resource was not found." },
      }),
      cache: "private, no-store",
    });
  });

  it("hides storage failures behind a fixed error without provider details", async () => {
    requests.getAttachmentDownload.mockRejectedValueOnce(new DocumentStorageError("READ_FAILED"));

    const response = await call();
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toBe(
      JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }),
    );
    expect(body).not.toContain("READ_FAILED");
  });

  it("rethrows unexpected errors instead of describing them", async () => {
    requests.getAttachmentDownload.mockRejectedValueOnce(new Error("database detail"));

    await expect(call()).rejects.toThrow("database detail");
  });
});

import { describe, expect, it } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  assertCanComment,
  canSeeComment,
  commentAudience,
  normalizeCommentBody,
  type CommentReader,
  type CommentRequestScope,
} from "@/modules/comments/domain/comment-policy";

// SPEC 2026-10-31-comentarios, section 5 (SF-053).

const owner: CommentReader = { id: "owner", role: "REQUESTER", isActive: true, sectorId: null };
const stranger: CommentReader = { id: "stranger", role: "REQUESTER", isActive: true, sectorId: null };
const ana: CommentReader = { id: "ana", role: "ATTENDANT", isActive: true, sectorId: "sector-1" };
const caio: CommentReader = { id: "caio", role: "ATTENDANT", isActive: true, sectorId: "sector-2" };
const admin: CommentReader = { id: "admin", role: "ADMIN", isActive: true, sectorId: null };
const request = (status: CommentRequestScope["status"] = "OPEN"): CommentRequestScope => ({
  requesterId: "owner",
  sectorId: "sector-1",
  status,
});

describe("comment policy", () => {
  it("lets only the owner and attendants of the current sector take part (section 5.1)", () => {
    expect(commentAudience(owner, request())).toBe("requester");
    expect(commentAudience(ana, request())).toBe("attendant");
    for (const reader of [stranger, caio, admin, { ...owner, isActive: false }, { ...ana, isActive: false }]) {
      expect(() => commentAudience(reader, request())).toThrow(NotFoundError);
    }
  });

  it("hides internal notes from the requester (decision C3)", () => {
    expect(canSeeComment("attendant", true)).toBe(true);
    expect(canSeeComment("attendant", false)).toBe(true);
    expect(canSeeComment("requester", false)).toBe(true);
    expect(canSeeComment("requester", true)).toBe(false);
  });

  it("accepts comments on open, in-progress and completed requests only (decision C1)", () => {
    for (const status of ["OPEN", "IN_PROGRESS", "COMPLETED"] as const) {
      expect(assertCanComment(owner, request(status), false)).toBe("requester");
      expect(assertCanComment(ana, request(status), true)).toBe("attendant");
    }
    expect(() => assertCanComment(owner, request("CANCELLED"), false)).toThrow(ConflictError);
    expect(() => assertCanComment(ana, request("CANCELLED"), false)).toThrow(ConflictError);
  });

  it("refuses internal notes from the requester", () => {
    expect(() => assertCanComment(owner, request(), true)).toThrow(ValidationError);
  });

  it("trims the text and limits it to 1 to 5,000 characters (section 5.3)", () => {
    expect(normalizeCommentBody("  Qual o prazo?  ")).toBe("Qual o prazo?");
    expect(normalizeCommentBody("é".repeat(5_000))).toHaveLength(5_000);
    for (const raw of ["", "   ", "a".repeat(5_001)]) {
      expect(() => normalizeCommentBody(raw)).toThrow(ValidationError);
    }
  });
});

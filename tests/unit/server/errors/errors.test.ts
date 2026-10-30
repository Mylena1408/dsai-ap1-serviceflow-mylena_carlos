import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  ValidationError,
  toErrorResponse,
} from "../../../../src/server/errors";
import { validateInput } from "../../../../src/server/validation";
import { requestCreationInputSchema } from "../../../../src/modules/requests/application/request-schemas";

describe("application errors", () => {
  it.each([
    [new AuthenticationError(), 401, "UNAUTHENTICATED"],
    [new AuthorizationError(), 403, "FORBIDDEN"],
    [new NotFoundError(), 404, "NOT_FOUND"],
    [new ConflictError(), 409, "CONFLICT"],
    [new InternalServerError(), 500, "INTERNAL_ERROR"],
  ])("serializes %s with a stable public response", (error, status, code) => {
    expect(toErrorResponse(error)).toEqual({
      status,
      body: {
        error: {
          code,
          message: expect.any(String),
        },
      },
    });
  });

  it("returns only safe validation metadata", () => {
    let error: unknown;

    try {
      validateInput(requestCreationInputSchema, {
        serviceId: "private-value",
        description: "secret-user-input",
        password: "top-secret",
      });
    } catch (caughtError) {
      error = caughtError;
    }

    const response = toErrorResponse(error);
    const serialized = JSON.stringify(response);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.issues).toBeDefined();
    expect(serialized).not.toContain("secret-user-input");
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("private-value");
    expect(serialized).not.toContain("stack");
  });

  it("sanitizes validation paths and issue codes before returning them", () => {
    const response = toErrorResponse(
      new ValidationError([
        { path: ["password", "secret-user-input"], code: "sensitive-value" },
        { path: ["newPassword", "password-value"], code: "too_small" },
        { path: ["description"], code: "too_big" },
      ]),
    );

    expect(response.body.error.issues).toEqual([
      { path: [], code: "custom" },
      { path: ["newPassword"], code: "too_small" },
      { path: ["description"], code: "too_big" },
    ]);
  });

  it("does not expose unexpected error messages, causes, or stack traces", () => {
    const error = new Error("database password is secret");
    error.stack = "Error: database password is secret\n at internal/path";
    const response = toErrorResponse(error);
    const serialized = JSON.stringify(response);

    expect(response).toEqual({
      status: 500,
      body: {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        },
      },
    });
    expect(serialized).not.toContain("database password");
    expect(serialized).not.toContain("internal/path");
    expect(serialized).not.toContain("stack");
  });
});

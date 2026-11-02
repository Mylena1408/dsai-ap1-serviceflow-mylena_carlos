import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { API_ERROR_CODES, API_ERROR_STATUS, apiErrorBody, apiErrorCodeFor } from "@/modules/public-api/domain/errors";
import { API_V1_OPERATIONS, OPENAPI_DOCUMENT } from "@/modules/public-api/domain/openapi";
import { requestDetailRepresentation, requestSummaryRepresentation } from "@/modules/public-api/domain/representation";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-02-api-externa-webhooks, 5.4 (SF-113; CA-API-07 and CA-API-09).

const API_DIRECTORY = join(process.cwd(), "src", "app", "api", "v1");

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === "route.ts" ? [path] : [];
  });
}

/** Operations declared by the route files: "/api/v1/requests/[requestId]" becomes "{requestId}". */
function routedOperations(): string[] {
  return routeFiles(API_DIRECTORY).flatMap((file) => {
    const segments = relative(API_DIRECTORY, file).split(sep).slice(0, -1);
    const path = "/api/v1/" + segments.map((segment) => segment.replace(/^\[(.+)\]$/, "{$1}")).join("/");
    const methods = [...readFileSync(file, "utf8").matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]!.toLowerCase());
    return methods.map((method) => `${method} ${path}`);
  });
}

describe("OpenAPI document (CA-API-09)", () => {
  it("describes exactly the operations that exist", () => {
    const declared = API_V1_OPERATIONS.map(({ method, path }) => `${method} ${path}`).sort();
    const documented = Object.entries(OPENAPI_DOCUMENT.paths)
      .flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method} ${path}`))
      .sort();

    expect(routedOperations().sort()).toEqual(declared);
    expect(documented).toEqual(declared);
  });

  it("documents every error code and the token scheme", () => {
    expect(OPENAPI_DOCUMENT.components.schemas.Error.properties.error.properties.code.enum).toEqual([...API_ERROR_CODES]);
    expect(OPENAPI_DOCUMENT.components.securitySchemes.bearerToken).toMatchObject({ type: "http", scheme: "bearer" });
    expect(OPENAPI_DOCUMENT.paths["/api/v1/openapi.json"].get.security).toEqual([]);
  });
});

describe("API errors (CA-API-07)", () => {
  it("have one body format with fixed messages and statuses", () => {
    expect(apiErrorBody("not_found")).toEqual({ error: { code: "not_found", message: "The resource was not found." } });
    expect(apiErrorBody("invalid_request", { issues: [{ path: ["search"], code: "invalid_value" }] })).toEqual({
      error: { code: "invalid_request", message: "The request is invalid.", issues: [{ path: ["search"], code: "invalid_value" }] },
    });
    expect(apiErrorBody("invalid_request", { issues: [], fields: [] })).toEqual({
      error: { code: "invalid_request", message: "The request is invalid." },
    });
    expect(API_ERROR_STATUS).toMatchObject({ invalid_token: 401, insufficient_scope: 403, documents_required: 422, rate_limited: 429 });
  });

  it("translate the application errors", () => {
    expect(["VALIDATION_ERROR", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "INTERNAL_ERROR", "OTHER"].map(apiErrorCodeFor)).toEqual([
      "invalid_request",
      "invalid_token",
      "forbidden",
      "not_found",
      "conflict",
      "internal_error",
      "internal_error",
    ]);
  });
});

describe("request representation", () => {
  const actor = { id: "u2", name: "Diego Rocha", email: "diego@exemplo.test" };
  const request = {
    id: "r1",
    requesterId: "u1",
    serviceId: "s1",
    sectorId: "sec1",
    serviceNameSnapshot: "Reparo elétrico",
    serviceDescriptionSnapshot: "Tomadas",
    categoryIdSnapshot: "c1",
    categoryNameSnapshot: "Manutenção",
    sectorNameSnapshot: "Central de Serviços",
    description: "Tomada solta",
    status: "IN_PROGRESS",
    createdAt: new Date("2026-11-02T10:00:00.000Z"),
    updatedAt: new Date("2026-11-02T11:00:00.000Z"),
    completedAt: null,
    assigneeId: "u2",
    cancelledAt: null,
    priority: "HIGH",
    slaHoursSnapshot: 8,
    dueAt: new Date("2026-11-02T14:00:00.000Z"),
    completedLate: null,
    stageNamesSnapshot: ["Triagem", "Execução"],
    stageIndex: 1,
    approvalState: null,
    events: [
      { id: "e1", requestId: "r1", actorId: "u1", fromStatus: null, toStatus: "OPEN", occurredAt: new Date("2026-11-02T10:00:00.000Z"), note: null, actor: { ...actor, id: "u1", name: "Ana", email: "ana@exemplo.test" } },
    ],
    priorityEvents: [],
    stageEvents: [],
    approval: null,
    assignmentEvents: [],
    service: { id: "s1", isActive: true },
    assignee: { id: "u2", name: "Diego Rocha", role: "ATTENDANT", isActive: true, sectorId: "sec1" },
  } as unknown as RequestWithHistory;

  it("uses English keys, ISO dates and codes, the current stage and no internal identifiers of people", () => {
    const summary = requestSummaryRepresentation(request, { assignee: { id: "u2", name: "Diego Rocha" }, slaSituation: "on_time" });

    expect(summary).toMatchObject({
      service: { id: "s1", name: "Reparo elétrico" },
      status: "IN_PROGRESS",
      priority: "HIGH",
      stage: "Execução",
      dueAt: "2026-11-02T14:00:00.000Z",
      slaSituation: "on_time",
    });
    expect(summary).not.toHaveProperty("requesterId");
    // E-mails of the people in the history never leave.
    const detail = requestDetailRepresentation(request, { assignee: null, slaSituation: "on_time" }, { answers: [], attachments: [], comments: [] });
    expect(JSON.stringify(detail)).not.toContain("@exemplo.test");
    expect(detail.history.status).toEqual([{ from: null, to: "OPEN", actor: { id: "u1", name: "Ana" }, note: null, occurredAt: "2026-11-02T10:00:00.000Z" }]);
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import {
  SATISFACTION_WINDOW_MS,
  assertCanRate,
  normalizeSatisfactionComment,
  replacesEarlierRating,
  satisfactionAvailability,
  satisfactionDeadline,
  type SatisfactionTarget,
} from "@/modules/requests/domain/satisfaction";
import { satisfactionSummary } from "@/modules/reports/domain/analytics";
import type { SatisfactionStore, SatisfactionTransaction } from "@/modules/requests/application/satisfaction";

const authorization = vi.hoisted(() => ({
  requireCurrentActor: vi.fn(),
  actorHasPermission: vi.fn(async () => false),
  assertRequestReadable: vi.fn(),
}));
vi.mock("@/server/authorization", () => authorization);

import { getRequestSatisfaction, rateRequest } from "@/modules/requests/application/satisfaction";
import { RequesterSatisfaction, TeamSatisfaction } from "@/app/_components/request-satisfaction";

// SPEC 2026-11-06-pesquisa-satisfacao, 4 (SF-150 and SF-151; CA-SAT-01 to 03, 05).

const DAY = 24 * 60 * 60 * 1000;
const completedAt = new Date("2026-11-01T12:00:00Z");
const requestId = "11111111-1111-4111-8111-111111111111";
const owner = { id: "owner", role: "REQUESTER", isActive: true };

const target = (overrides: Partial<SatisfactionTarget> = {}): SatisfactionTarget => ({
  requesterId: "owner",
  status: "COMPLETED",
  completedAt,
  ratedCompletionAt: null,
  ...overrides,
});

describe("satisfaction rules (4.1 to 4.3)", () => {
  it("is available for 30 days after the completion, then expires", () => {
    expect(satisfactionAvailability(target(), new Date(completedAt.getTime() + DAY))).toBe("available");
    expect(satisfactionAvailability(target(), new Date(completedAt.getTime() + SATISFACTION_WINDOW_MS))).toBe("available");
    expect(satisfactionAvailability(target(), new Date(completedAt.getTime() + SATISFACTION_WINDOW_MS + 1))).toBe("expired");
    expect(satisfactionDeadline(completedAt).getTime()).toBe(completedAt.getTime() + 30 * DAY);
  });

  it("is not available before the completion", () => {
    for (const status of ["OPEN", "IN_PROGRESS", "CANCELLED"] as const) {
      expect(satisfactionAvailability(target({ status }), completedAt)).toBe("not_completed");
    }
    expect(satisfactionAvailability(target({ completedAt: null }), completedAt)).toBe("not_completed");
  });

  it("is rated once per completion, and open again after a new completion", () => {
    expect(satisfactionAvailability(target({ ratedCompletionAt: completedAt }), completedAt)).toBe("rated");
    const earlier = new Date(completedAt.getTime() - 5 * DAY);
    expect(satisfactionAvailability(target({ ratedCompletionAt: earlier }), completedAt)).toBe("available");
    expect(replacesEarlierRating(target({ ratedCompletionAt: earlier }))).toBe(true);
    expect(replacesEarlierRating(target())).toBe(false);
  });

  it("refuses others with not found and the owner out of time with a conflict", () => {
    const now = new Date(completedAt.getTime() + DAY);
    expect(() => assertCanRate(owner, target(), now)).not.toThrow();
    expect(() => assertCanRate({ ...owner, id: "other" }, target(), now)).toThrow(NotFoundError);
    expect(() => assertCanRate({ ...owner, isActive: false }, target(), now)).toThrow(NotFoundError);
    expect(() => assertCanRate({ ...owner, role: "ATTENDANT" }, target(), now)).toThrow(NotFoundError);
    expect(() => assertCanRate(owner, target({ status: "IN_PROGRESS" }), now)).toThrow(ConflictError);
    expect(() => assertCanRate(owner, target({ ratedCompletionAt: completedAt }), now)).toThrow(ConflictError);
    expect(() => assertCanRate(owner, target(), new Date(completedAt.getTime() + 31 * DAY))).toThrow(ConflictError);
  });

  it("treats a blank comment as no comment", () => {
    expect(normalizeSatisfactionComment("  ")).toBeNull();
    expect(normalizeSatisfactionComment(undefined)).toBeNull();
    expect(normalizeSatisfactionComment("  Rápido e gentil ")).toBe("Rápido e gentil");
  });
});

function fakeStore(initial: SatisfactionTarget | null) {
  const saved: Parameters<SatisfactionTransaction["save"]>[0][] = [];
  const store: SatisfactionStore = {
    async run(work) {
      return work({
        findActor: async (id) => (id === "owner" ? owner : null),
        findTarget: async () => initial,
        currentTime: async () => new Date(completedAt.getTime() + DAY),
        save: async (input) => {
          saved.push(input);
        },
      });
    },
    find: async () => null,
    history: async () => [],
    findTarget: async () => initial,
  };
  return { store, saved };
}

describe("rateRequest (4.1 to 4.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorization.requireCurrentActor.mockResolvedValue(owner);
  });

  it("saves the rating with the database time and the completion it refers to", async () => {
    const { store, saved } = fakeStore(target());
    await rateRequest({ requestId, rating: "4", comment: "  Resolveu rápido " }, store);
    expect(saved).toEqual([
      {
        requestId,
        requesterId: "owner",
        rating: 4,
        comment: "Resolveu rápido",
        completedAtSnapshot: completedAt,
        ratedAt: new Date(completedAt.getTime() + DAY),
        replaced: false,
      },
    ]);
  });

  it("marks the replacement of a rating of an earlier completion", async () => {
    const { store, saved } = fakeStore(target({ ratedCompletionAt: new Date("2026-10-01T00:00:00Z") }));
    await rateRequest({ requestId, rating: 5 }, store);
    expect(saved[0]).toMatchObject({ rating: 5, comment: null, replaced: true });
  });

  it.each([
    [{ requestId, rating: 0 }],
    [{ requestId, rating: 6 }],
    [{ requestId, rating: 3.5 }],
    [{ requestId, rating: "" }],
    [{ requestId, rating: 3, comment: "x".repeat(1001) }],
    [{ requestId: "not-a-uuid", rating: 3 }],
    [{ requestId, rating: 3, extra: true }],
  ])("refuses %j without saving", async (input) => {
    const { store, saved } = fakeStore(target());
    await expect(rateRequest(input, store)).rejects.toThrow(ValidationError);
    expect(saved).toEqual([]);
  });

  it("refuses a request that does not exist", async () => {
    const { store, saved } = fakeStore(null);
    await expect(rateRequest({ requestId, rating: 3 }, store)).rejects.toThrow(NotFoundError);
    expect(saved).toEqual([]);
  });

  it("refuses a second rating of the same completion", async () => {
    const { store, saved } = fakeStore(target({ ratedCompletionAt: completedAt }));
    await expect(rateRequest({ requestId, rating: 3 }, store)).rejects.toThrow(ConflictError);
    expect(saved).toEqual([]);
  });
});

describe("getRequestSatisfaction (4.6)", () => {
  it("checks the read rule before reading", async () => {
    authorization.requireCurrentActor.mockResolvedValue({ id: "attendant", role: "ATTENDANT", sectorId: "s", isActive: true });
    authorization.assertRequestReadable.mockImplementation(() => {
      throw new NotFoundError();
    });
    const { store } = fakeStore(target());
    const scope = { findRequestScope: vi.fn(async () => ({ requesterId: "owner", sectorId: "other" })) };
    await expect(getRequestSatisfaction(requestId, scope, store, completedAt)).rejects.toThrow(NotFoundError);
  });
});

describe("satisfaction summary of the analytics (4.7)", () => {
  it("computes the average, the full distribution, the response rate and the per-service averages", () => {
    const summary = satisfactionSummary({
      distribution: [
        { rating: 5, count: 3 },
        { rating: 2, count: 1 },
      ],
      completed: 8,
      ratedCompletions: 4,
      byService: [
        { label: "Reparo", count: 3, sum: 13 },
        { label: "Acesso", count: 1, sum: 5 },
      ],
    });
    expect(summary).toEqual({
      count: 4,
      average: 4.3,
      distribution: [
        { rating: 5, count: 3 },
        { rating: 4, count: 0 },
        { rating: 3, count: 0 },
        { rating: 2, count: 1 },
        { rating: 1, count: 0 },
      ],
      responseRate: 50,
      byService: [
        { label: "Reparo", count: 3, average: 4.3, fewData: false },
        { label: "Acesso", count: 1, average: 5, fewData: true },
      ],
    });
  });

  it("shows no average or rate without data", () => {
    expect(satisfactionSummary({ distribution: [], completed: 0, ratedCompletions: 0, byService: [] })).toMatchObject({
      count: 0,
      average: null,
      responseRate: null,
      byService: [],
    });
  });
});

describe("satisfaction screens", () => {
  const action = async (): Promise<never> => {
    throw new Error("not called");
  };
  const view = (overrides = {}) => ({
    current: null,
    history: [],
    availability: "available" as const,
    deadline: new Date("2026-12-01T12:00:00Z"),
    ...overrides,
  });
  const rated = {
    current: { rating: 4, comment: "Gostei", ratedAt: new Date("2026-11-02T12:00:00Z"), completedAtSnapshot: completedAt },
    history: [
      { rating: 2, replaced: false, occurredAt: new Date("2026-10-02T12:00:00Z"), actorName: "Rita" },
      { rating: 4, replaced: true, occurredAt: new Date("2026-11-02T12:00:00Z"), actorName: "Rita" },
    ],
  };

  it("shows the form with five options and the deadline while available", () => {
    const html = renderToStaticMarkup(createElement(RequesterSatisfaction, { requestId, view: view(), action }));
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    expect(html).toContain("5 · Muito satisfeito");
    expect(html).toContain("Você pode avaliar até 01/12/2026");
  });

  it("shows the result instead of the form once rated, with earlier ratings", () => {
    const html = renderToStaticMarkup(createElement(RequesterSatisfaction, { requestId, view: view({ ...rated, availability: "rated" }), action }));
    expect(html).not.toContain('type="radio"');
    expect(html).toContain("4 de 5 · Satisfeito");
    expect(html).toContain("Gostei");
    expect(html).toContain("Avaliações anteriores");
    expect(html).toContain("2 de 5");
  });

  it("explains a new completion replaces the earlier rating", () => {
    const html = renderToStaticMarkup(createElement(RequesterSatisfaction, { requestId, view: view({ ...rated, availability: "available" }), action }));
    expect(html).toContain("a nova vai substituí-la");
    expect(html.match(/type="radio"/g)).toHaveLength(5);
  });

  it("shows nothing before the completion, and the end of the window after it", () => {
    expect(renderToStaticMarkup(createElement(RequesterSatisfaction, { requestId, view: view({ availability: "not_completed" }), action }))).toBe("");
    expect(renderToStaticMarkup(createElement(RequesterSatisfaction, { requestId, view: view({ availability: "expired" }), action }))).toContain(
      "O prazo para avaliar terminou",
    );
  });

  it("shows the team the rating and the comment, and nothing without a rating", () => {
    expect(renderToStaticMarkup(createElement(TeamSatisfaction, { view: view({ ...rated, availability: "rated" }) }))).toContain("Avaliação do solicitante");
    expect(renderToStaticMarkup(createElement(TeamSatisfaction, { view: view() }))).toBe("");
  });
});

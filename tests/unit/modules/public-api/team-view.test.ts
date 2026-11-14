import { describe, expect, it } from "vitest";
import { OPENAPI_DOCUMENT } from "@/modules/public-api/domain/openapi";
import {
  checklistRepresentation,
  requestDetailRepresentation,
  tagsRepresentation,
  teamRepresentation,
  type ApiTeamView,
} from "@/modules/public-api/domain/representation";
import type { RequestWithHistory } from "@/modules/requests";

// SPEC 2026-11-08-atendimento-dia-a-dia, 9.1 item 2 (SF-221; decision I20; CA-CMP-02): the detail carries the
// tags, the checklist and the minutes logged for the team of the sector, and null for anyone else.

const item = (overrides: Partial<NonNullable<ApiTeamView["checklist"]["items"]>[number]> = {}) => ({
  id: "i1",
  textSnapshot: "Conferir backup",
  isRequired: true,
  position: 1,
  doneAt: null,
  doneById: null,
  doneByName: null,
  note: null,
  ...overrides,
});

const team = (overrides: Partial<ApiTeamView> = {}): ApiTeamView => ({
  tags: {
    tags: [
      { id: "t1", name: "Urgente", color: "red", isActive: true, fromOtherSector: false },
      { id: "t2", name: "Rede", color: "blue", isActive: false, fromOtherSector: true },
    ],
  },
  checklist: {
    items: [
      item({ id: "i1", doneAt: new Date("2026-11-14T12:00:00.000Z"), doneById: "u2", doneByName: "Diego Rocha", note: "ok" }),
      item({ id: "i2", textSnapshot: "Avisar o usuário", isRequired: false, position: 2 }),
    ],
  },
  time: { totalMinutes: 135 },
  ...overrides,
});

const request = {
  id: "r1",
  requesterId: "u1",
  serviceId: "s1",
  sectorId: "sec1",
  serviceNameSnapshot: "Reparo elétrico",
  categoryIdSnapshot: "c1",
  categoryNameSnapshot: "Manutenção",
  sectorNameSnapshot: "Central de Serviços",
  description: "Tomada solta",
  status: "IN_PROGRESS",
  createdAt: new Date("2026-11-02T10:00:00.000Z"),
  updatedAt: new Date("2026-11-02T11:00:00.000Z"),
  completedAt: null,
  cancelledAt: null,
  priority: "HIGH",
  dueAt: null,
  completedLate: null,
  stageNamesSnapshot: [],
  stageIndex: null,
  approvalState: null,
  events: [],
  priorityEvents: [],
  stageEvents: [],
  approval: null,
  assignmentEvents: [],
} as unknown as RequestWithHistory;

const detail = (extra: { team?: ApiTeamView | null } = {}) =>
  requestDetailRepresentation(request, { assignee: null, slaSituation: "on_time" }, { answers: [], attachments: [], comments: [], ...extra });

describe("tags, checklist and minutes in the API detail (SF-221)", () => {
  it("the tags keep their order, with the color key, whether active and whether from a former sector", () => {
    expect(tagsRepresentation(team().tags)).toEqual([
      { id: "t1", name: "Urgente", color: "red", active: true, fromOtherSector: false },
      { id: "t2", name: "Rede", color: "blue", active: false, fromOtherSector: true },
    ]);
  });

  it("the checklist counts the marked items and lists each with required, done, when and by whom", () => {
    expect(checklistRepresentation(team().checklist)).toEqual({
      done: 1,
      total: 2,
      items: [
        { id: "i1", text: "Conferir backup", required: true, done: true, doneAt: "2026-11-14T12:00:00.000Z", doneBy: { id: "u2", name: "Diego Rocha" } },
        { id: "i2", text: "Avisar o usuário", required: false, done: false, doneAt: null, doneBy: null },
      ],
    });
  });

  it("the item's note stays on the screen: the API carries what 9.1 item 2 names", () => {
    expect(JSON.stringify(checklistRepresentation(team().checklist))).not.toContain('"ok"');
  });

  it("a request without checklist items has a null checklist, never copied or copied empty", () => {
    expect(checklistRepresentation({ items: null })).toBeNull();
    expect(checklistRepresentation({ items: [] })).toBeNull();
  });

  it("a marking whose person has no name left still names the id", () => {
    const marked = checklistRepresentation({ items: [item({ doneAt: new Date("2026-11-14T12:00:00.000Z"), doneById: "u9", doneByName: null })] });
    expect(marked?.items[0]?.doneBy).toEqual({ id: "u9", name: "—" });
  });

  it("the team gets the three fields; anyone else gets null in each", () => {
    expect(teamRepresentation(team())).toMatchObject({ tags: [{ id: "t1" }, { id: "t2" }], checklist: { done: 1, total: 2 }, minutesLogged: 135 });
    expect(teamRepresentation(null)).toEqual({ tags: null, checklist: null, minutesLogged: null });
  });

  it("the team without tags, checklist or time gets an empty list, null and zero", () => {
    expect(teamRepresentation({ tags: { tags: [] }, checklist: { items: null }, time: { totalMinutes: 0 } })).toEqual({
      tags: [],
      checklist: null,
      minutesLogged: 0,
    });
  });

  it("the detail carries them, and without the team view (older callers) they are null", () => {
    expect(detail({ team: team() })).toMatchObject({ tags: [{ name: "Urgente" }, { name: "Rede" }], checklist: { total: 2 }, minutesLogged: 135 });
    expect(detail()).toMatchObject({ tags: null, checklist: null, minutesLogged: null });
    expect(detail({ team: null })).toMatchObject({ tags: null, checklist: null, minutesLogged: null });
  });

  it("the other fields of the detail do not change", () => {
    const NEW = new Set(["tags", "checklist", "minutesLogged"]);
    const others = (value: object) => Object.fromEntries(Object.entries(value).filter(([key]) => !NEW.has(key)));
    expect(others(detail({ team: team() }))).toEqual(others(detail()));
  });

  it("the OpenAPI document describes the three fields of the detail", () => {
    const schemas = OPENAPI_DOCUMENT.components.schemas as unknown as Record<string, { allOf: Array<{ properties?: Record<string, { type: unknown }> }> }>;
    const properties = schemas.RequestDetail.allOf[1]!.properties!;
    expect(properties.tags.type).toEqual(["array", "null"]);
    expect(properties.checklist.type).toEqual(["object", "null"]);
    expect(properties.minutesLogged.type).toEqual(["integer", "null"]);
  });
});

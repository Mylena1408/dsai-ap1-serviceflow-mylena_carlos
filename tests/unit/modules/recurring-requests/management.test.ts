import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthorizationError, ValidationError } from "@/server/errors";
import {
  MAX_ACTIVE_SCHEDULES,
  assertScheduleRoom,
  inScheduleScope,
  requesterSchedulable,
  scheduleActions,
  scheduleScopeOf,
  serviceSchedulable,
  type ScheduleView,
} from "@/modules/recurring-requests";
import { RecurringSchedules, periodText, runText, scheduleMessage, scheduleWarning } from "@/app/_components/recurring-schedules";
import type { ScheduleScreen } from "@/app/_components/recurring-schedule-screen";

// SPEC 2026-11-07-operacao-e-automacao, 5.3 items 1, 2 and 4 (SF-185; CA-REC-02 and 05 by the rules and the screen).

const service = { id: "s", name: "Ar", sectorId: "m", sectorName: "Manutenção", isActive: true, categoryActive: true, sectorActive: true, activeRequirements: 0 };

describe("who manages and what may be scheduled (5.3 items 1 and 2)", () => {
  it("the administrator everywhere, a manager in their sector, nobody else", () => {
    expect(scheduleScopeOf({ role: "ADMIN", sectorId: null })).toEqual({ sectorId: null });
    expect(scheduleScopeOf({ role: "MANAGER", sectorId: "m" })).toEqual({ sectorId: "m" });
    for (const actor of [
      { role: "MANAGER" as const, sectorId: null },
      { role: "ATTENDANT" as const, sectorId: "m" },
      { role: "REQUESTER" as const, sectorId: null },
    ]) {
      expect(() => scheduleScopeOf(actor)).toThrow(AuthorizationError);
    }
    expect(inScheduleScope({ sectorId: null }, "x")).toBe(true);
    expect(inScheduleScope({ sectorId: "m" }, "m")).toBe(true);
    expect(inScheduleScope({ sectorId: "m" }, "x")).toBe(false);
  });

  it("a service active, in the catalog and without required documents; an active requester", () => {
    expect(serviceSchedulable(service)).toBe(true);
    for (const change of [{ isActive: false }, { categoryActive: false }, { sectorActive: false }, { activeRequirements: 1 }]) {
      expect(serviceSchedulable({ ...service, ...change })).toBe(false);
    }
    expect(requesterSchedulable({ id: "r", role: "REQUESTER", isActive: true })).toBe(true);
    expect(requesterSchedulable({ id: "r", role: "REQUESTER", isActive: false })).toBe(false);
    expect(requesterSchedulable({ id: "r", role: "ATTENDANT", isActive: true })).toBe(false);
    expect(requesterSchedulable(null)).toBe(false);
  });

  it(`stops at ${MAX_ACTIVE_SCHEDULES} schedules in force (decision H22)`, () => {
    expect(() => assertScheduleRoom(MAX_ACTIVE_SCHEDULES - 1)).not.toThrow();
    expect(() => assertScheduleRoom(MAX_ACTIVE_SCHEDULES)).toThrow(ValidationError);
  });

  it("offers the actions of each state (5.3 item 4)", () => {
    expect(scheduleActions("active")).toEqual(["edit", "pause", "end"]);
    expect(scheduleActions("paused")).toEqual(["edit", "resume", "end"]);
    expect(scheduleActions("ended")).toEqual([]);
    expect(scheduleActions("finished")).toEqual([]);
  });
});

const schedule = (overrides: Partial<ScheduleView> = {}): ScheduleView => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Limpeza do ar",
  description: "Filtros",
  answers: { f1: "Sala 12" },
  frequency: "WEEKLY",
  weekdays: [1, 4],
  monthDay: null,
  startsOn: "2026-11-09",
  endsOn: null,
  service: { id: "s", name: "Ar", sectorId: "m", sectorName: "Manutenção" },
  requester: { id: "r", name: "Rita" },
  createdBy: { id: "g", name: "Gabi" },
  pausedAt: null,
  endedAt: null,
  consecutiveFailures: 0,
  runs: [],
  status: "active",
  nextOn: "2026-11-09",
  actions: ["edit", "pause", "end"],
  ...overrides,
});

describe("the schedules screen (5.3 item 4)", () => {
  it("describes the period, the runs and the warnings", () => {
    expect(periodText({ startsOn: "2026-11-09", endsOn: null })).toBe("A partir de 09/11/2026");
    expect(periodText({ startsOn: "2026-11-09", endsOn: "2027-11-09" })).toBe("De 09/11/2026 a 09/11/2027");
    expect(runText({ scheduledOn: "2026-11-09", outcome: "OPENED", reason: null, requestId: "q" })).toBe("09/11/2026: aberta");
    expect(runText({ scheduledOn: "2026-11-12", outcome: "SKIPPED", reason: "FORM_CHANGED", requestId: null })).toBe(
      "12/11/2026: não aberta (o formulário do serviço mudou)",
    );
    const skipped = { scheduledOn: "2026-11-12", outcome: "SKIPPED" as const, reason: "REQUESTER_INACTIVE" as const, requestId: null };
    expect(scheduleWarning(schedule())).toBeNull();
    expect(scheduleWarning(schedule({ runs: [skipped] }))).toBe("A última execução não abriu a solicitação.");
    expect(scheduleWarning(schedule({ status: "paused", consecutiveFailures: 3, runs: [skipped] }))).toMatch(/^Pausada pelo sistema: 3 execuções/);
    expect(scheduleWarning(schedule({ status: "ended", runs: [skipped] }))).toBeNull();
    expect(scheduleMessage("schedule-created")).toEqual({ text: "Agenda criada.", error: false });
    expect(scheduleMessage("schedule-limit")?.error).toBe(true);
    expect(scheduleMessage("anything")).toBeNull();
  });

  const screen = (overrides: Partial<ScheduleScreen> = {}): ScheduleScreen => ({
    overview: {
      today: "2026-11-07",
      schedules: [
        schedule(),
        schedule({ id: "22222222-2222-4222-8222-222222222222", name: "Troca mensal", frequency: "MONTHLY", weekdays: [], monthDay: 10, status: "ended", nextOn: null, actions: [] }),
      ],
      services: [{ id: "s", name: "Ar", sectorName: "Manutenção" }],
      requesters: [{ id: "r", name: "Rita" }],
    },
    form: null,
    formUnavailable: false,
    ...overrides,
  });

  it("lists the schedules with the actions of their state and offers a new one", () => {
    const html = renderToStaticMarkup(createElement(RecurringSchedules, { area: "approvals", screen: screen() }));
    expect(html).toContain("Semanal: segunda e quinta");
    expect(html).toContain("Mensal: dia 10");
    expect(html).toContain("09/11/2026");
    expect(html).toContain("Encerrada");
    expect(html).toContain('href="/approvals/recurring?edit=11111111-1111-4111-8111-111111111111"');
    expect(html).not.toContain("edit=22222222");
    expect(html.match(/>Pausar</g)).toHaveLength(1);
    expect(html).toContain("Serviço da nova agenda");
    expect(html).not.toContain('name="section"');
  });

  it("opens the form with the saved values of the schedule being changed", () => {
    const editing = screen().overview.schedules[0];
    const html = renderToStaticMarkup(
      createElement(RecurringSchedules, {
        area: "admin",
        screen: screen({
          form: {
            serviceId: "s",
            serviceName: "Ar",
            editing,
            fields: [{ id: "f1", label: "Sala", helpText: null, type: "SHORT_TEXT", isRequired: true, options: [], minValue: null, maxValue: null }],
            fieldErrors: {},
          },
        }),
      }),
    );
    expect(html).toContain("Alterar &quot;Limpeza do ar&quot;");
    expect(html).toContain('value="Sala 12"');
    expect(html).toContain('value="Limpeza do ar"');
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="4"|<input[^>]*value="4"[^>]*checked=""/);
    expect(html).toContain('name="scheduleId"');
    expect(html).toContain("Salvar alterações");
    expect(html).not.toContain("Serviço da nova agenda");
  });

  it("says when the schedule asked for cannot be changed now", () => {
    const html = renderToStaticMarkup(createElement(RecurringSchedules, { area: "admin", screen: screen({ formUnavailable: true }) }));
    expect(html).toContain("Esta agenda não pode ser alterada agora");
    expect(html).toContain('type="hidden" name="section" value="recurring"');
  });
});

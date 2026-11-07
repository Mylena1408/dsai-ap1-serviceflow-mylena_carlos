import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import type { AbsencePerson, AttendantAbsenceRecord, AttendantAbsenceTransaction } from "@/modules/absences/application/attendant-absences";

const authorization = vi.hoisted(() => ({ actor: null as unknown }));
vi.mock("@/server/authorization", () => ({ requireCurrentActor: vi.fn(async () => authorization.actor) }));

import { cancelAttendantAbsence, listAttendantAbsences, registerAttendantAbsence } from "@/modules/absences/application/attendant-absences";
import { handOverAbsentAttendants, type AbsenceHandoverStore } from "@/modules/requests/application/absence-handover";
import { AttendantAbsences, attendantAbsenceMessage, attendantAbsenceSituation } from "@/app/_components/attendant-absences";

// SPEC 2026-11-07-operacao-e-automacao, 4.3 item 7 (SF-182; CA-DST-05 by the rules and the screens).

const today = "2026-11-07";
const ANA = "11111111-1111-4111-8111-111111111111";
const ABS = "22222222-2222-4222-8222-222222222222";
const admin = { id: "adm", role: "ADMIN" as const, isActive: true, sectorId: null };
const gabi = { id: "gabi", role: "MANAGER" as const, isActive: true, sectorId: "ti" };
const ana: AbsencePerson = { id: ANA, name: "Ana", role: "ATTENDANT", isActive: true, sectorId: "ti", sectorName: "TI" };

function store(state: { person?: AbsencePerson | null; absence?: { id: string; userId: string; endsOn: string; cancelledAt: Date | null } | null } = {}) {
  const transaction: AttendantAbsenceTransaction = {
    today: vi.fn(async () => today),
    findPerson: vi.fn(async () => (state.person === undefined ? ana : state.person)),
    absencesOf: vi.fn(async () => []),
    findAbsence: vi.fn(async () => (state.absence === undefined ? { id: ABS, userId: ANA, endsOn: "2026-11-12", cancelledAt: null } : state.absence)),
    create: vi.fn(async () => ({ id: ABS })),
    cancel: vi.fn(async () => undefined),
  };
  const list = vi.fn(async () => [] as AttendantAbsenceRecord[]);
  const attendants = vi.fn(async () => [{ id: ANA, name: "Ana", sectorName: "TI" }]);
  return {
    transaction,
    list,
    attendants,
    store: { run: <T>(work: (t: AttendantAbsenceTransaction) => Promise<T>) => work(transaction), today: vi.fn(async () => today), list, attendants },
  };
}

beforeEach(() => {
  authorization.actor = admin;
});

describe("registering an attendant's absence (4.3 item 7)", () => {
  it("the administrator names anyone, the manager the attendants of the sector, the attendant themselves", async () => {
    const asAdmin = store();
    await registerAttendantAbsence({ userId: ANA, startsOn: "2026-11-10", endsOn: "2026-11-12" }, asAdmin.store);
    expect(asAdmin.transaction.create).toHaveBeenCalledWith({ userId: ANA, startsOn: "2026-11-10", endsOn: "2026-11-12", createdById: "adm" });

    authorization.actor = gabi;
    await registerAttendantAbsence({ userId: ANA, startsOn: "2026-11-10", endsOn: "2026-11-12" }, store().store);
    authorization.actor = { ...gabi, sectorId: "rh" };
    await expect(registerAttendantAbsence({ userId: ANA, startsOn: "2026-11-10", endsOn: "2026-11-12" }, store().store)).rejects.toThrow(NotFoundError);

    authorization.actor = { id: ANA, role: "ATTENDANT", isActive: true, sectorId: "ti" };
    const own = store();
    await registerAttendantAbsence({ startsOn: "2026-11-10", endsOn: "2026-11-12" }, own.store);
    expect(own.transaction.findPerson).toHaveBeenCalledWith(ANA);

    authorization.actor = { id: "rita", role: "REQUESTER", isActive: true, sectorId: null };
    await expect(registerAttendantAbsence({ startsOn: "2026-11-10", endsOn: "2026-11-12" }, store().store)).rejects.toThrow(AuthorizationError);
  });

  it("refuses periods out of the rules and people who are not active attendants", async () => {
    await expect(registerAttendantAbsence({ userId: ANA, startsOn: "2026-11-01", endsOn: "2026-11-03" }, store().store)).rejects.toThrow(ValidationError);
    await expect(registerAttendantAbsence({ userId: ANA, startsOn: "x", endsOn: "2026-11-03" }, store().store)).rejects.toThrow(ValidationError);
    await expect(
      registerAttendantAbsence({ userId: ANA, startsOn: "2026-11-10", endsOn: "2026-11-12" }, store({ person: { ...ana, role: "MANAGER" } }).store),
    ).rejects.toThrow(NotFoundError);
    await expect(registerAttendantAbsence({ userId: ANA, startsOn: "2026-11-10", endsOn: "2026-11-12" }, store({ person: null }).store)).rejects.toThrow(NotFoundError);
  });

  it("cancels an absence not ended, by whoever may register for the person", async () => {
    const own = store();
    await cancelAttendantAbsence(ABS, own.store);
    expect(own.transaction.cancel).toHaveBeenCalledWith(ABS);
    await expect(cancelAttendantAbsence(ABS, store({ absence: { id: ABS, userId: ANA, endsOn: "2026-11-01", cancelledAt: null } }).store)).rejects.toThrow(ConflictError);
    await expect(cancelAttendantAbsence(ABS, store({ absence: null }).store)).rejects.toThrow(NotFoundError);
    authorization.actor = { id: "bia", role: "ATTENDANT", isActive: true, sectorId: "ti" };
    await expect(cancelAttendantAbsence(ABS, store().store)).rejects.toThrow(NotFoundError);
  });

  it("lists by scope: every sector, the manager's sector, or the attendant's own", async () => {
    const asAdmin = store();
    await listAttendantAbsences(asAdmin.store);
    expect(asAdmin.list).toHaveBeenCalledWith({ sectorId: null, userId: null });
    authorization.actor = gabi;
    const asManager = store();
    await listAttendantAbsences(asManager.store);
    expect(asManager.list).toHaveBeenCalledWith({ sectorId: "ti", userId: null });
    expect(asManager.attendants).toHaveBeenCalledWith("ti");
    authorization.actor = { id: ANA, role: "ATTENDANT", isActive: true, sectorId: "ti" };
    const asAttendant = store();
    await expect(listAttendantAbsences(asAttendant.store)).resolves.toMatchObject({ attendants: [] });
    expect(asAttendant.list).toHaveBeenCalledWith({ sectorId: null, userId: ANA });
  });
});

describe("handing over by the job (4.3 item 7)", () => {
  it("marks each absence first, hands over each request in its own transaction and counts what stayed", async () => {
    const handovers = [ANA, null];
    const transactions = {
      run: vi.fn(async (work: (t: never) => Promise<unknown>) => {
        void work;
        return handovers.shift() ?? null;
      }),
    };
    const handoverStore = {
      dueAbsences: vi.fn(async () => [
        { absenceId: "a1", userId: "bia", sectorId: "ti" },
        { absenceId: "a2", userId: "caio", sectorId: "ti" },
      ]),
      heldRequests: vi.fn(async (userId: string) => (userId === "bia" ? [{ id: "q1", status: "OPEN" as const }, { id: "q2", status: "IN_PROGRESS" as const }] : [])),
      markHandedOver: vi.fn(async (absenceId: string) => absenceId === "a1"),
      transactions,
    } as unknown as AbsenceHandoverStore;
    await expect(handOverAbsentAttendants(handoverStore)).resolves.toEqual({ absences: 1, handedOver: 1, kept: 1 });
    expect(transactions.run).toHaveBeenCalledTimes(2);
  });
});

describe("the absences block", () => {
  const record = (overrides: Partial<AttendantAbsenceRecord> = {}): AttendantAbsenceRecord => ({
    id: ABS,
    startsOn: "2026-11-06",
    endsOn: "2026-11-08",
    cancelledAt: null,
    redistributedAt: null,
    createdAt: new Date(),
    attendant: { id: ANA, name: "Ana", sectorName: "TI" },
    createdBy: { id: "adm", name: "Admin" },
    ...overrides,
  });

  it("says the situation, including the handover", () => {
    expect(attendantAbsenceSituation(record(), today)).toBe("Em vigor");
    expect(attendantAbsenceSituation(record({ redistributedAt: new Date() }), today)).toBe("Em vigor · solicitações passadas a colegas");
    expect(attendantAbsenceSituation(record({ startsOn: "2026-11-10", endsOn: "2026-11-12" }), today)).toBe("Agendada");
    expect(attendantAbsenceSituation(record({ endsOn: "2026-11-06" }), today)).toBe("Encerrada");
    expect(attendantAbsenceSituation(record({ cancelledAt: new Date() }), today)).toBe("Cancelada");
    expect(attendantAbsenceMessage("attendant-absence-registered")).toEqual({ text: "Ausência registrada.", error: false });
    expect(attendantAbsenceMessage("absence-registered")).toBeNull();
  });

  it("offers the attendant picker to the administrator and the manager, not to the attendant", () => {
    const overview = { today, absences: [record()], attendants: [{ id: ANA, name: "Ana", sectorName: "TI" }] };
    const forAdmin = renderToStaticMarkup(createElement(AttendantAbsences, { overview, area: "admin" }));
    expect(forAdmin).toContain('name="userId"');
    expect(forAdmin).toContain('name="area" value="admin"');
    expect(forAdmin).toContain(">Cancelar<");
    const forAttendant = renderToStaticMarkup(createElement(AttendantAbsences, { overview: { ...overview, attendants: [] }, area: "queue" }));
    expect(forAttendant).not.toContain('name="userId"');
    expect(forAttendant).toContain("Registrar ausência");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { getAnnouncementStrip, type AnnouncementStripReader } from "@/modules/announcements/application/announcement-strip";
import type { AnnouncementRecord } from "@/modules/announcements";
import { AnnouncementStripView, stripHeading } from "@/app/_components/announcement-strip";

// SPEC 2026-11-09-comunicacao-e-calendarios, 3.1 item 3 (SF-238; decision K2; CA-AVI-04): the maintenance shows with
// its lead as "programada" and during the window as "em andamento", in the organization's time zone.

const at = (iso: string) => new Date(iso);

// Window from 22:00 to 02:00 (São Paulo, UTC-3), announced 24 hours before.
const window = (overrides: Partial<AnnouncementRecord> = {}): AnnouncementRecord => ({
  id: "m",
  title: "Atualização do sistema",
  body: "O sistema pode ficar lento.",
  kind: "MAINTENANCE",
  level: "WARNING",
  audience: "ALL",
  audienceRole: null,
  audienceSectorId: null,
  startsAt: at("2026-11-22T01:00:00.000Z"),
  endsAt: at("2026-11-22T05:00:00.000Z"),
  leadHours: 24,
  createdAt: at("2026-11-14T12:00:00.000Z"),
  ...overrides,
});

function reader(now: Date, candidates: AnnouncementRecord[]): AnnouncementStripReader {
  return { now: vi.fn(async () => now), candidates: vi.fn(async () => candidates), dismissedIds: vi.fn(async () => []) };
}

beforeEach(() => {
  vi.clearAllMocks();
  authorization.requireCurrentActor.mockResolvedValue({ id: "u1", role: "REQUESTER", sectorId: null, isActive: true });
});

describe("the phase of a maintenance at the database's instant", () => {
  it.each([
    ["before the lead", "2026-11-21T00:59:00.000Z", []],
    ["at the start of the lead", "2026-11-21T01:00:00.000Z", ["scheduled"]],
    ["just before the window", "2026-11-22T00:59:59.000Z", ["scheduled"]],
    ["at the start of the window", "2026-11-22T01:00:00.000Z", ["in_progress"]],
    ["during the window", "2026-11-22T04:00:00.000Z", ["in_progress"]],
    ["at the end of the window", "2026-11-22T05:00:00.000Z", []],
  ])("%s", async (_label, now, phases) => {
    const strip = await getAnnouncementStrip(reader(at(now), [window()]));
    expect(strip.map(({ phase }) => phase)).toEqual(phases);
  });

  it("without a lead, the strip starts with the window", async () => {
    const strip = await getAnnouncementStrip(reader(at("2026-11-22T00:59:00.000Z"), [window({ leadHours: 0 })]));
    expect(strip).toEqual([]);
    expect((await getAnnouncementStrip(reader(at("2026-11-22T01:00:00.000Z"), [window({ leadHours: 0 })])))[0]!.phase).toBe("in_progress");
  });

  it("a notice has no phase, and a maintenance is never dismissible", async () => {
    const notice = window({ id: "n", kind: "NOTICE", level: "INFO", leadHours: null, startsAt: at("2026-11-20T00:00:00.000Z") });
    const strip = await getAnnouncementStrip(reader(at("2026-11-21T12:00:00.000Z"), [window(), notice]));
    expect(strip.map(({ id, phase, dismissible }) => [id, phase, dismissible])).toEqual([
      ["m", "scheduled", false],
      ["n", null, true],
    ]);
  });
});

describe("the maintenance in the strip", () => {
  it("names the phase and the window in the organization's time zone", () => {
    expect(stripHeading({ ...window(), phase: "scheduled" })).toEqual({ label: "Manutenção programada", when: "De 21/11/2026 22:00 a 22/11/2026 02:00." });
    expect(stripHeading({ ...window(), phase: "in_progress" })).toEqual({ label: "Manutenção em andamento", when: "Até 22/11/2026 02:00." });
    expect(stripHeading({ ...window({ kind: "NOTICE" }), phase: null })).toEqual({ label: "Atenção", when: null });
  });

  it("is drawn as a warning, with the window and without \"Dispensar\"", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementStripView, { announcements: [{ ...window(), phase: "scheduled", dismissible: false }] }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("<strong>Manutenção programada:</strong> <strong>Atualização do sistema</strong>");
    expect(html).toContain("<p>De 21/11/2026 22:00 a 22/11/2026 02:00.</p>");
    expect(html).not.toContain("Dispensar");
  });
});

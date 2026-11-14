import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ requireCurrentActor: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { getAnnouncementStrip, type AnnouncementStripReader } from "@/modules/announcements/application/announcement-strip";
import type { AnnouncementRecord } from "@/modules/announcements";
import { AnnouncementStripView, STRIP_COLORS } from "@/app/_components/announcement-strip";
import { contrastRatio } from "@/modules/tags";
import { AuthenticationError } from "@/server/errors";

// SPEC 2026-11-09-comunicacao-e-calendarios, 3.1 item 2 and 3.3 items 2 to 4 (SF-236; CA-AVI-01 and CA-AVI-03).

const SECTOR = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-22T12:00:00.000Z");
const at = (iso: string) => new Date(iso);

const record = (overrides: Partial<AnnouncementRecord> = {}): AnnouncementRecord => ({
  id: "a",
  title: "Aviso",
  body: "Texto do aviso.",
  kind: "NOTICE",
  level: "INFO",
  audience: "ALL",
  audienceRole: null,
  audienceSectorId: null,
  startsAt: at("2026-11-20T12:00:00.000Z"),
  endsAt: at("2026-11-27T12:00:00.000Z"),
  leadHours: null,
  createdAt: at("2026-11-14T12:00:00.000Z"),
  ...overrides,
});

function reader(candidates: AnnouncementRecord[], dismissed: string[] = []): AnnouncementStripReader {
  return {
    now: vi.fn(async () => NOW),
    candidates: vi.fn(async () => candidates),
    dismissedIds: vi.fn(async (_user: string, ids: readonly string[]) => dismissed.filter((id) => ids.includes(id))),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authorization.requireCurrentActor.mockResolvedValue({ id: "u1", role: "ATTENDANT", sectorId: SECTOR, isActive: true });
});

describe("getAnnouncementStrip", () => {
  it("reads the candidates for the person's audience at the database's instant", async () => {
    const source = reader([record()]);
    const strip = await getAnnouncementStrip(source);
    expect(source.candidates).toHaveBeenCalledWith({ id: "u1", role: "ATTENDANT", sectorId: SECTOR }, NOW);
    expect(strip).toEqual([expect.objectContaining({ id: "a", dismissible: true })]);
  });

  it("leaves out what the rules leave out: other audiences, not shown now, dismissed information; at most three, urgent first", async () => {
    const source = reader(
      [
        record({ id: "info-1", startsAt: at("2026-11-21T12:00:00.000Z") }),
        record({ id: "info-dismissed" }),
        record({ id: "warning", level: "WARNING" }),
        record({ id: "other-role", audience: "ROLE", audienceRole: "MANAGER" }),
        record({ id: "mine", audience: "SECTOR", audienceSectorId: SECTOR, startsAt: at("2026-11-19T12:00:00.000Z") }),
        record({ id: "future", startsAt: at("2026-11-23T12:00:00.000Z") }),
        record({ id: "info-old", startsAt: at("2026-11-15T12:00:00.000Z") }),
      ],
      ["info-dismissed"],
    );
    const strip = await getAnnouncementStrip(source);
    expect(strip.map(({ id, dismissible }) => `${id}:${dismissible}`)).toEqual(["warning:false", "info-1:true", "mine:true"]);
    // Only information notices are looked up among the dismissals.
    expect(vi.mocked(source.dismissedIds).mock.calls[0]![1]).not.toContain("warning");
  });

  it("does not look up dismissals without candidates", async () => {
    const source = reader([]);
    expect(await getAnnouncementStrip(source)).toEqual([]);
    expect(source.dismissedIds).not.toHaveBeenCalled();
  });

  it("refuses without a session before reading", async () => {
    authorization.requireCurrentActor.mockRejectedValue(new AuthenticationError());
    const source = reader([record()]);
    await expect(getAnnouncementStrip(source)).rejects.toThrow(AuthenticationError);
    expect(source.now).not.toHaveBeenCalled();
  });
});

describe("the strip on the screen", () => {
  const item = (overrides: Partial<AnnouncementRecord> = {}) => ({ ...record(overrides), dismissible: true, phase: null });

  it("draws nothing without announcements (CA-AVI-01)", () => {
    expect(renderToStaticMarkup(createElement(AnnouncementStripView, { announcements: [] }))).toBe("");
  });

  it("shows the level, the title and the text, a warning as an alert and an information as a status", () => {
    const html = renderToStaticMarkup(
      createElement(AnnouncementStripView, {
        announcements: [item({ id: "w", level: "WARNING", title: "Sistema lento", body: "Estamos verificando." }), item({ id: "i", title: "Novo catálogo" })],
      }),
    );
    expect(html).toContain('<section aria-label="Avisos" class="announcement-strip">');
    expect(html).toContain('role="alert"');
    expect(html).toContain("<strong>Atenção:</strong> <strong>Sistema lento</strong>");
    expect(html).toContain("<p>Estamos verificando.</p>");
    expect(html).toContain('role="status"');
    expect(html).toContain("<strong>Informação:</strong> <strong>Novo catálogo</strong>");
    expect(html.indexOf("Sistema lento")).toBeLessThan(html.indexOf("Novo catálogo"));
  });

  it("escapes the texts typed by the administrator", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementStripView, { announcements: [item({ title: "<b>x</b>", body: "<script>1</script>" })] }));
    // React adds its own form script next to a server action (the button "Dispensar"); the typed text is escaped.
    expect(html).not.toContain("<script>1</script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;script&gt;1&lt;/script&gt;");
  });

  it.each(Object.entries(STRIP_COLORS))("the %s colors pass WCAG AA (4.5:1)", (_level, colors) => {
    expect(contrastRatio(colors.text, colors.background)).toBeGreaterThanOrEqual(4.5);
  });
});

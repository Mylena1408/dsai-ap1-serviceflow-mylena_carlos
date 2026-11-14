import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import {
  closeAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncementsForAdmin,
  updateAnnouncement,
  type AnnouncementAdminReader,
  type AnnouncementAdminStore,
  type AnnouncementAdminTransaction,
} from "@/modules/announcements/application/announcement-admin";
import { AnnouncementConflict, formatAnnouncementInstant, toLocalDateTimeInput, type AnnouncementRecord } from "@/modules/announcements";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/errors";
import { announcementErrorCode, announcementMessage } from "@/app/(admin)/admin/_sections/announcements/messages";
import { AnnouncementsSection, audienceText, periodText } from "@/app/(admin)/admin/_sections/announcements/announcements-section";
import { auditValueFormatter } from "@/app/(admin)/admin/_sections/audit/audit-section";
import { describeAuditChange } from "@/modules/audit";

// SPEC 2026-11-09-comunicacao-e-calendarios, 3.1 item 1 and 3.3 items 1, 2 and 5 (SF-235; CA-AVI-02).

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECTOR = "11111111-1111-4111-8111-111111111111";
const admin = { id: "admin-1", role: "ADMIN", sectorId: null, isActive: true };
const NOW = new Date("2026-11-22T12:00:00.000Z");

const record = (overrides: Partial<AnnouncementRecord> = {}): AnnouncementRecord => ({
  id: ID,
  title: "Novo catálogo",
  body: "O catálogo foi reorganizado.",
  kind: "NOTICE",
  level: "INFO",
  audience: "ALL",
  audienceRole: null,
  audienceSectorId: null,
  startsAt: new Date("2026-11-20T12:00:00.000Z"),
  endsAt: new Date("2026-11-27T12:00:00.000Z"),
  leadHours: null,
  createdAt: new Date("2026-11-14T12:00:00.000Z"),
  ...overrides,
});

const form = {
  title: "Novo catálogo",
  body: "O catálogo foi reorganizado.",
  kind: "NOTICE",
  level: "INFO",
  audience: "ALL",
  startsAt: "2026-11-23T09:00",
  endsAt: "2026-11-30T18:00",
};

function store(current: AnnouncementRecord | null = record(), sector: { id: string; isActive: boolean } | null = { id: SECTOR, isActive: true }) {
  const audits: Array<{ action: string; entityId?: string }> = [];
  const transaction = {
    audited: vi.fn(async (meta: { action: string; entityId?: string }, change: () => Promise<{ id: string }>) => {
      audits.push({ action: meta.action, entityId: meta.entityId });
      return change();
    }),
    now: vi.fn(async () => NOW),
    find: vi.fn(async () => current),
    findSector: vi.fn(async () => sector),
    create: vi.fn(async (data) => ({ ...record(), ...data, id: "new" })),
    update: vi.fn(async (_id, data) => ({ ...record(), ...data })),
    delete: vi.fn(async (id: string) => ({ id })),
  } as unknown as AnnouncementAdminTransaction & { [key: string]: ReturnType<typeof vi.fn> };
  const value: AnnouncementAdminStore = { run: (work) => work(transaction) };
  return { store: value, transaction, audits };
}

beforeEach(() => {
  vi.clearAllMocks();
  authorization.requireConfigurationAdministrator.mockResolvedValue(admin);
});

describe("who manages announcements (3.1 item 1)", () => {
  it("refuses anyone but the administrator before reading or writing", async () => {
    authorization.requireConfigurationAdministrator.mockRejectedValue(new AuthorizationError());
    const { store: target, transaction } = store();
    await expect(createAnnouncement(form, target)).rejects.toThrow(AuthorizationError);
    await expect(updateAnnouncement(ID, form, target)).rejects.toThrow(AuthorizationError);
    await expect(closeAnnouncement(ID, target)).rejects.toThrow(AuthorizationError);
    await expect(deleteAnnouncement(ID, target)).rejects.toThrow(AuthorizationError);
    expect(transaction.find).not.toHaveBeenCalled();
    expect(transaction.create).not.toHaveBeenCalled();
  });
});

describe("createAnnouncement", () => {
  it("stores the typed data with the author, in the audit trail", async () => {
    const { store: target, transaction, audits } = store();
    await createAnnouncement({ ...form, audience: "SECTOR", audienceSectorId: SECTOR }, target);
    expect(transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Novo catálogo",
        audience: "SECTOR",
        audienceSectorId: SECTOR,
        startsAt: new Date("2026-11-23T12:00:00.000Z"),
        endsAt: new Date("2026-11-30T21:00:00.000Z"),
        createdById: admin.id,
      }),
    );
    expect(audits).toEqual([{ action: "CREATED", entityId: undefined }]);
  });

  it("refuses an invalid form before the transaction", async () => {
    const { store: target, transaction } = store();
    await expect(createAnnouncement({ ...form, title: "" }, target)).rejects.toThrow(ValidationError);
    expect(transaction.now).not.toHaveBeenCalled();
  });

  it("refuses an end already past and an inactive or missing sector", async () => {
    await expect(createAnnouncement({ ...form, startsAt: "2026-11-01T09:00", endsAt: "2026-11-22T08:00" }, store().store)).rejects.toMatchObject({
      reason: "ends_in_past",
    });
    await expect(createAnnouncement({ ...form, audience: "SECTOR", audienceSectorId: SECTOR }, store(record(), { id: SECTOR, isActive: false }).store)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ path: ["audienceSectorId"] }],
    });
    await expect(createAnnouncement({ ...form, audience: "SECTOR", audienceSectorId: SECTOR }, store(record(), null).store)).rejects.toThrow(ValidationError);
  });
});

describe("updateAnnouncement", () => {
  it("changes one going on, keeping its start in the past, with the audit trail", async () => {
    const { store: target, transaction, audits } = store();
    await updateAnnouncement(ID, { ...form, startsAt: "2026-11-20T09:00", title: "Catálogo novo" }, target);
    expect(transaction.update).toHaveBeenCalledWith(ID, expect.objectContaining({ title: "Catálogo novo" }));
    expect(audits).toEqual([{ action: "UPDATED", entityId: ID }]);
  });

  it("refuses moving the start of one going on past now, changing an ended one, and a missing one", async () => {
    await expect(updateAnnouncement(ID, form, store().store)).rejects.toMatchObject({ reason: "start_moved" });
    await expect(updateAnnouncement(ID, form, store(record({ endsAt: new Date("2026-11-21T12:00:00.000Z") })).store)).rejects.toMatchObject({
      reason: "ended",
    });
    await expect(updateAnnouncement(ID, form, store(null).store)).rejects.toThrow(NotFoundError);
  });

  it("moves the start of one scheduled freely", async () => {
    const scheduled = record({ startsAt: new Date("2026-11-25T12:00:00.000Z"), endsAt: new Date("2026-11-28T12:00:00.000Z") });
    const { store: target, transaction } = store(scheduled);
    await updateAnnouncement(ID, form, target);
    expect(transaction.update).toHaveBeenCalled();
  });
});

describe("closeAnnouncement and deleteAnnouncement (3.3 item 5)", () => {
  it("closes one going on with the end at the database's instant", async () => {
    const { store: target, transaction, audits } = store();
    await closeAnnouncement(ID, target);
    expect(transaction.update).toHaveBeenCalledWith(ID, { endsAt: NOW });
    expect(audits).toEqual([{ action: "UPDATED", entityId: ID }]);
  });

  it("does not close one scheduled or ended", async () => {
    await expect(closeAnnouncement(ID, store(record({ startsAt: new Date("2026-11-25T12:00:00.000Z") })).store)).rejects.toMatchObject({ reason: "not_current" });
    await expect(closeAnnouncement(ID, store(record({ endsAt: new Date("2026-11-21T12:00:00.000Z") })).store)).rejects.toMatchObject({ reason: "not_current" });
  });

  it("deletes only one scheduled, with the audit trail", async () => {
    const scheduled = record({ startsAt: new Date("2026-11-25T12:00:00.000Z") });
    const { store: target, transaction, audits } = store(scheduled);
    await deleteAnnouncement(ID, target);
    expect(transaction.delete).toHaveBeenCalledWith(ID);
    expect(audits).toEqual([{ action: "DELETED", entityId: ID }]);
    await expect(deleteAnnouncement(ID, store().store)).rejects.toMatchObject({ reason: "not_scheduled" });
  });

  it("refuses an id that is not one before the transaction", async () => {
    const { store: target, transaction } = store();
    await expect(deleteAnnouncement("x", target)).rejects.toThrow(ValidationError);
    expect(transaction.find).not.toHaveBeenCalled();
  });
});

describe("listAnnouncementsForAdmin", () => {
  it("reads the last 90 days and orders: going on, scheduled (nearest first), ended (latest first)", async () => {
    const at = (iso: string) => new Date(iso);
    const extra = { audienceSectorName: null, createdByName: "Marina" };
    const rows = [
      { ...record({ id: "ended-old", startsAt: at("2026-10-01T12:00:00.000Z"), endsAt: at("2026-10-02T12:00:00.000Z") }), ...extra },
      { ...record({ id: "scheduled-far", startsAt: at("2026-12-10T12:00:00.000Z"), endsAt: at("2026-12-11T12:00:00.000Z") }), ...extra },
      { ...record({ id: "current" }), ...extra },
      { ...record({ id: "ended-new", startsAt: at("2026-11-10T12:00:00.000Z"), endsAt: at("2026-11-11T12:00:00.000Z") }), ...extra },
      { ...record({ id: "scheduled-near", startsAt: at("2026-11-24T12:00:00.000Z"), endsAt: at("2026-11-25T12:00:00.000Z") }), ...extra },
    ];
    const reader: AnnouncementAdminReader = { now: vi.fn(async () => NOW), list: vi.fn(async () => rows), activeSectors: vi.fn(async () => []) };
    const overview = await listAnnouncementsForAdmin(reader);
    expect(reader.list).toHaveBeenCalledWith(new Date(NOW.getTime() - 90 * 86_400_000));
    expect(overview.announcements.map(({ id, status }) => `${id}:${status}`)).toEqual([
      "current:current",
      "scheduled-near:scheduled",
      "scheduled-far:scheduled",
      "ended-new:ended",
      "ended-old:ended",
    ]);
  });
});

describe("messages (SF-235: each refusal has its own)", () => {
  it.each([
    ["VALIDATION_ERROR", null, "title", "invalid-title"],
    ["VALIDATION_ERROR", null, "audienceSectorId", "invalid-sector"],
    ["VALIDATION_ERROR", null, "endsAt", "invalid-end"],
    ["VALIDATION_ERROR", null, "leadHours", "invalid-lead"],
    ["VALIDATION_ERROR", null, "", "invalid"],
    ["CONFLICT", "start_moved", null, "start-moved"],
    ["CONFLICT", "not_scheduled", null, "not-scheduled"],
    ["NOT_FOUND", null, null, "missing"],
  ] as const)("%s %s %s → %s", (code, reason, path, expected) => {
    expect(announcementErrorCode(code, reason, path)).toBe(expected);
    expect(announcementMessage(expected)).not.toBeNull();
  });

  it("the conflict of each reason is still a conflict", () => {
    expect(new AnnouncementConflict("ended")).toMatchObject({ code: "CONFLICT", reason: "ended" });
  });
});

describe("the section \"Avisos\"", () => {
  const item = (overrides: Partial<AnnouncementRecord> = {}, status: "current" | "scheduled" | "ended" = "current") => ({
    ...record(overrides),
    status,
    audienceSectorName: "Central",
    createdByName: "Marina Alves",
  });

  it("describes the audience and the period, with the strip of a maintenance", () => {
    expect(audienceText(item())).toBe("Todos");
    expect(audienceText(item({ audience: "ROLE", audienceRole: "ATTENDANT" }))).toBe("Perfil: Atendente");
    expect(audienceText(item({ audience: "SECTOR", audienceSectorId: SECTOR }))).toBe("Setor: Central");
    expect(periodText(item())).toBe("20/11/2026 09:00 a 27/11/2026 09:00");
    expect(
      periodText(item({ kind: "MAINTENANCE", level: "WARNING", startsAt: new Date("2026-11-22T01:00:00.000Z"), endsAt: new Date("2026-11-22T05:00:00.000Z"), leadHours: 24 })),
    ).toBe("21/11/2026 22:00 a 22/11/2026 02:00 (na faixa desde 20/11/2026 22:00)");
  });

  it("offers close to the one going on, delete to the scheduled one and nothing but the row to the ended one", () => {
    const html = renderToStaticMarkup(
      createElement(AnnouncementsSection, {
        overview: {
          now: NOW,
          sectors: [{ id: SECTOR, name: "Central" }],
          announcements: [item({ id: "c", title: "Agora" }), item({ id: "s", title: "Depois" }, "scheduled"), item({ id: "e", title: "Antes" }, "ended")],
        },
        message: "closed",
      }),
    );
    expect(html).toContain('aria-label="Encerrar o aviso Agora"');
    expect(html).not.toContain('aria-label="Apagar o aviso Agora"');
    expect(html).toContain('aria-label="Apagar o aviso Depois"');
    expect(html).not.toContain('aria-label="Encerrar o aviso Depois"');
    expect(html).not.toContain('aria-label="Alterar o aviso Antes"');
    expect(html).toContain("Aviso encerrado.");
    expect(html).toContain('value="2026-11-20T09:00"');
    expect(html).toContain('<option value="11111111-1111-4111-8111-111111111111">Central</option>');
  });

  it("explains an empty list", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementsSection, { overview: { now: NOW, sectors: [], announcements: [] } }));
    expect(html).toContain("Nenhum aviso em andamento, programado ou encerrado nos últimos 90 dias.");
  });
});

describe("the audit trail of an announcement", () => {
  const format = auditValueFormatter({ [SECTOR]: "Central" });

  it("names the kind, level, audience, role and sector, and shows the dates in the organization's time zone", () => {
    expect(describeAuditChange({ field: "kind", before: null, after: "MAINTENANCE" }, format)).toBe("Tipo: — → Manutenção");
    expect(describeAuditChange({ field: "level", before: "INFO", after: "WARNING" }, format)).toBe("Nível: Informação → Atenção");
    expect(describeAuditChange({ field: "target", before: "ALL", after: "SECTOR" }, format)).toBe("Público: Todos → Um setor");
    expect(describeAuditChange({ field: "targetRole", before: null, after: "MANAGER" }, format)).toBe("Perfil do público: — → Gestor");
    expect(describeAuditChange({ field: "targetSectorId", before: null, after: SECTOR }, format)).toBe("Setor do público: — → Central");
    expect(describeAuditChange({ field: "endsAt", before: "2026-11-27T12:00:00.000Z", after: "2026-11-22T12:00:00.000Z" }, format)).toBe(
      "Fim: 27/11/2026 09:00 → 22/11/2026 09:00",
    );
  });

  it("the form gets the stored instants back as typed", () => {
    expect(toLocalDateTimeInput(new Date("2026-11-20T12:00:00.000Z"))).toBe("2026-11-20T09:00");
    expect(formatAnnouncementInstant(new Date("2027-01-01T02:59:00.000Z"))).toBe("31/12/2026 23:59");
  });
});

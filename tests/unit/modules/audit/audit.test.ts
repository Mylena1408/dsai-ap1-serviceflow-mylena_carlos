import { describe, expect, it } from "vitest";
import type { AuditAction, AuditEntityType } from "@prisma/client";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  AUDIT_ENTITY_TYPES,
  activeStateAction,
  auditChanges,
  describeAuditChange,
  planAuditEntry,
} from "@/modules/audit/domain/audit";

// SPEC 2026-11-02-auditoria-lgpd, 5.1 and 5.2 (SF-102; CA-AUD-02 and CA-AUD-03).

describe("changed fields (CA-AUD-02)", () => {
  it("records the fields that changed, with their values, in order", () => {
    expect(
      auditChanges(
        "SERVICE",
        { name: "Reparo", slaHours: 24, requiresApproval: false, defaultPriority: "NORMAL" },
        { name: "Reparo", slaHours: 12, requiresApproval: true, defaultPriority: "NORMAL" },
      ),
    ).toEqual([
      { field: "slaHours", before: 24, after: 12 },
      { field: "requiresApproval", before: false, after: true },
    ]);
  });

  it("records nothing when nothing really changed", () => {
    expect(auditChanges("SECTOR", { name: "TI", isActive: true }, { name: "TI", isActive: true })).toEqual([]);
    expect(auditChanges("DOCUMENT_REQUIREMENT", { acceptedFormats: ["PDF", "TXT"] }, { acceptedFormats: ["PDF", "TXT"] })).toEqual([]);
    expect(auditChanges("SERVICE", { slaHours: null }, { slaHours: undefined })).toEqual([]);
  });

  it("compares lists and dates by value", () => {
    expect(auditChanges("DOCUMENT_REQUIREMENT", { acceptedFormats: ["PDF"] }, { acceptedFormats: ["PDF", "DOCX"] })).toEqual([
      { field: "acceptedFormats", before: ["PDF"], after: ["PDF", "DOCX"] },
    ]);
    const date = new Date("2026-11-02T12:00:00.000Z");
    expect(auditChanges("USER", { anonymizedAt: null }, { anonymizedAt: date })).toEqual([
      { field: "anonymizedAt", before: null, after: "2026-11-02T12:00:00.000Z" },
    ]);
    expect(auditChanges("USER", { anonymizedAt: date }, { anonymizedAt: new Date(date) })).toEqual([]);
  });

  it("records every field with a value on creation", () => {
    expect(auditChanges("SERVICE_STAGE", null, { name: "Triagem", position: 0, isActive: true, helpText: null })).toEqual([
      { field: "name", before: null, after: "Triagem" },
      { field: "position", before: null, after: 0 },
      { field: "isActive", before: null, after: true },
    ]);
  });

  it("keeps a field that disappeared from the new state", () => {
    expect(auditChanges("SERVICE_FIELD", { helpText: "Dica" }, {})).toEqual([{ field: "helpText", before: "Dica", after: null }]);
  });
});

describe("personal data and secrets (CA-AUD-03)", () => {
  it("says only that the name or e-mail of a user changed", () => {
    const changes = auditChanges(
      "USER",
      { name: "Carla Mendes", email: "carla@exemplo.test", role: "REQUESTER" },
      { name: "Carla M. Souza", email: "carla.souza@exemplo.test", role: "ATTENDANT" },
    );

    expect(changes).toEqual([
      { field: "name", personal: true },
      { field: "email", personal: true },
      { field: "role", before: "REQUESTER", after: "ATTENDANT" },
    ]);
    expect(JSON.stringify(changes)).not.toMatch(/Carla|exemplo\.test/);
  });

  it("hides the name and e-mail of a new user too", () => {
    expect(auditChanges("USER", null, { name: "Diego", email: "diego@exemplo.test", role: "ATTENDANT" })).toEqual([
      { field: "name", personal: true },
      { field: "email", personal: true },
      { field: "role", before: null, after: "ATTENDANT" },
    ]);
  });

  it("keeps the name of other entities, which is not personal data", () => {
    expect(auditChanges("SECTOR", { name: "TI" }, { name: "Tecnologia" })).toEqual([{ field: "name", before: "TI", after: "Tecnologia" }]);
  });

  it("never records passwords, hashes, secrets or tokens", () => {
    const changes = auditChanges(
      "USER",
      { passwordHash: "$argon2id$old", password: "old", apiToken: "a", clientSecret: "b", isActive: true },
      { passwordHash: "$argon2id$new", password: "new", apiToken: "c", clientSecret: "d", isActive: false },
    );

    expect(changes).toEqual([{ field: "isActive", before: true, after: false }]);
  });
});

describe("texts (section 5.2)", () => {
  it("describes each change in Portuguese", () => {
    expect(describeAuditChange({ field: "slaHours", before: 24, after: 12 })).toBe("Prazo-base (horas): 24 → 12");
    expect(describeAuditChange({ field: "requiresApproval", before: false, after: true })).toBe("Exige aprovação: Não → Sim");
    expect(describeAuditChange({ field: "email", personal: true })).toBe("E-mail: alterado");
    expect(describeAuditChange({ field: "helpText", before: null, after: "Dica" })).toBe("Texto de ajuda: — → Dica");
    expect(describeAuditChange({ field: "acceptedFormats", before: ["PDF"], after: ["PDF", "DOCX"] })).toBe(
      "Formatos aceitos: PDF → PDF, DOCX",
    );
    expect(describeAuditChange({ field: "unknownField", before: 1, after: 2 })).toBe("unknownField: 1 → 2");
  });

  it("lets the screen name ids and enum values", () => {
    const names: Record<string, string> = { s1: "Infraestrutura", s2: "Pessoas" };
    const format = (field: string, value: unknown) => (field === "sectorId" && typeof value === "string" ? names[value] : undefined);

    expect(describeAuditChange({ field: "sectorId", before: "s1", after: "s2" }, format)).toBe("Setor: Infraestrutura → Pessoas");
    expect(describeAuditChange({ field: "sectorId", before: null, after: "s2" }, format)).toBe("Setor: — → Pessoas");
  });

  it("has a text for every action and entity of the database", () => {
    const actions: Record<AuditAction, true> = {
      CREATED: true,
      UPDATED: true,
      REORDERED: true,
      DEACTIVATED: true,
      REACTIVATED: true,
      ANONYMIZED: true,
      EXPORTED: true,
      REVOKED: true,
      SECRET_ROTATED: true,
      // Added by SPEC 2026-11-03 (pausa do prazo e calendário).
      DELETED: true,
      // Added by SPEC 2026-11-07-operacao-e-automacao, 6.4.
      IMPORTED: true,
      EXPORTED_CONFIGURATION: true,
    };
    const entities: Record<AuditEntityType, true> = {
      USER: true,
      SECTOR: true,
      CATEGORY: true,
      SERVICE: true,
      DOCUMENT_REQUIREMENT: true,
      SERVICE_FIELD: true,
      SERVICE_STAGE: true,
      API_TOKEN: true,
      WEBHOOK: true,
      // Added by SPEC 2026-11-03 (pausa do prazo e calendário).
      BUSINESS_CALENDAR: true,
      HOLIDAY: true,
      // Added by SPEC 2026-11-06-base-conhecimento, 4.5.
      KNOWLEDGE_ARTICLE: true,
      // Added by SPEC 2026-11-06-aprofundamento-configurabilidade, 6.3.3.
      ACCESS_ROLE: true,
      // Added by SPEC 2026-11-06-aprofundamento-configurabilidade, 7.4.
      ESCALATION_RULE: true,
      // Added by SPEC 2026-11-07-operacao-e-automacao, 3.4.
      SERVICE_BUNDLE: true,
      RECURRING_REQUEST: true,
      CONFIGURATION: true,
      // Added by SPEC 2026-11-08-atendimento-dia-a-dia, 3.4.
      SECTOR_TAG: true,
      // Added by SPEC 2026-11-08-atendimento-dia-a-dia, 4.4.
      CHECKLIST_ITEM: true,
      // Added by SPEC 2026-11-09-comunicacao-e-calendarios, 3.3 item 5.
      ANNOUNCEMENT: true,
    };

    expect([...AUDIT_ACTIONS].sort()).toEqual(Object.keys(actions).sort());
    expect([...AUDIT_ENTITY_TYPES].sort()).toEqual(Object.keys(entities).sort());
    for (const action of AUDIT_ACTIONS) expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
    for (const entity of AUDIT_ENTITY_TYPES) expect(AUDIT_ENTITY_LABELS[entity]).toBeTruthy();
  });
});

describe("planning an entry (SF-103; CA-AUD-02)", () => {
  const meta = { actor: { id: "admin-1", role: "ADMIN" as const }, entityType: "USER" as const, entityId: "u1", entityLabel: "Carla" };

  it("keeps only the audited fields of the entity, so hashes never reach the record", () => {
    const entry = planAuditEntry(
      { ...meta, action: "UPDATED" },
      { name: "Carla", role: "REQUESTER", passwordHash: "$argon2id$a", updatedAt: new Date(1) },
      { name: "Carla", role: "ATTENDANT", passwordHash: "$argon2id$b", updatedAt: new Date(2) },
    );

    expect(entry).toEqual({
      actorId: "admin-1",
      actorRole: "ADMIN",
      action: "UPDATED",
      entityType: "USER",
      entityId: "u1",
      entityLabel: "Carla",
      changes: [{ field: "role", before: "REQUESTER", after: "ATTENDANT" }],
    });
  });

  it("plans nothing for an update, move, deactivation or reactivation without change", () => {
    const state = { name: "Carla", isActive: true };
    for (const action of ["UPDATED", "REORDERED", "DEACTIVATED", "REACTIVATED"] as const) {
      expect(planAuditEntry({ ...meta, action }, state, state)).toBeNull();
    }
  });

  it("always plans a creation, an anonymization and an export", () => {
    const state = { isActive: false };
    expect(planAuditEntry({ ...meta, action: "CREATED" }, null, state)?.changes).toEqual([{ field: "isActive", before: null, after: false }]);
    expect(planAuditEntry({ ...meta, action: "ANONYMIZED" }, state, state)?.changes).toEqual([]);
    expect(planAuditEntry({ ...meta, action: "EXPORTED" }, state, state)?.action).toBe("EXPORTED");
  });

  it("names deactivation and reactivation from the requested state", () => {
    expect(activeStateAction(false)).toBe("DEACTIVATED");
    expect(activeStateAction(true)).toBe("REACTIVATED");
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, ConflictError, ValidationError } from "@/server/errors";

const authorization = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("@/server/authorization", () => ({
  requireConfigurationAdministrator: vi.fn(async () => {
    if (authorization.role !== "ADMIN") throw new AuthorizationError();
    return { id: "adm", role: "ADMIN", isActive: true, sectorId: null };
  }),
}));

import type { ConfigurationSnapshot } from "@/modules/configuration";
import { applyConfigurationImport, type ConfigurationApplyTransaction } from "@/modules/configuration/application/apply-import";
import { destinationOf } from "@/modules/configuration/application/preview-import";

// SPEC 2026-11-07-operacao-e-automacao, 6.3 item 5 (SF-189; CA-CFG-04 by the rules).

const empty: ConfigurationSnapshot = {
  sectors: [],
  escalationRules: [],
  cannedResponses: [],
  categories: [],
  services: [],
  fields: [],
  documents: [],
  stages: [],
  articles: [],
  accessRoles: [],
  calendar: null,
  holidays: [],
  bundles: [],
  emails: {},
};
const content = JSON.stringify({
  format: "serviceflow-config",
  version: 1,
  exportedAt: "2026-11-08T10:00:00.000Z",
  data: { sectors: [], categories: [{ name: "Acesso", isActive: true }], services: [], accessRoles: [], calendar: null, holidays: [], bundles: [] },
});
const digest = createHash("sha256").update(content, "utf8").digest("hex");
const destinationDigest = destinationOf(empty).digest;

function store() {
  const transaction: ConfigurationApplyTransaction = {
    snapshot: vi.fn(async () => empty),
    facts: vi.fn(async () => ({ sectorsWithPendingRequests: [], sectorsWithActiveAttendants: [] })),
    people: vi.fn(async () => []),
    write: vi.fn(async () => {}),
    recordImport: vi.fn(async () => {}),
  };
  let runs = 0;
  return {
    transaction,
    runs: () => runs,
    run<T>(work: (t: ConfigurationApplyTransaction) => Promise<T>): Promise<T> {
      runs += 1;
      return work(transaction);
    },
  };
}

describe("applying an import (6.3 item 5)", () => {
  it("writes the plan and the import's entry with the summary", async () => {
    const target = store();
    await expect(applyConfigurationImport({ content, digest, destinationDigest }, target)).resolves.toEqual({ new: 1, changed: 0, equal: 0 });
    expect(target.transaction.write).toHaveBeenCalledWith(
      expect.objectContaining({ items: [{ kind: "category", label: "Acesso", status: "new", changes: [] }] }),
      expect.objectContaining({ id: "adm" }),
    );
    expect(target.transaction.recordImport).toHaveBeenCalledWith(expect.objectContaining({ id: "adm" }), { new: 1, changed: 0, equal: 0 });
  });

  it("refuses another file before opening the transaction, and a changed destination inside it", async () => {
    const other = store();
    await expect(applyConfigurationImport({ content: `${content}\n`, digest, destinationDigest }, other)).rejects.toBeInstanceOf(ConflictError);
    expect(other.runs()).toBe(0);

    const changed = store();
    await expect(applyConfigurationImport({ content, digest, destinationDigest: "0".repeat(64) }, changed)).rejects.toBeInstanceOf(ConflictError);
    expect(changed.transaction.write).not.toHaveBeenCalled();
  });

  it("refuses a file the preview would refuse, a malformed confirmation, and anyone but the administrator", async () => {
    const invalid = JSON.stringify({ format: "serviceflow-config", version: 1, exportedAt: "", data: { ...JSON.parse(content).data, categories: [{ name: " ", isActive: true }] } });
    const target = store();
    await expect(
      applyConfigurationImport({ content: invalid, digest: createHash("sha256").update(invalid, "utf8").digest("hex"), destinationDigest }, target),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(target.transaction.write).not.toHaveBeenCalled();
    await expect(applyConfigurationImport({ content, digest: "x", destinationDigest }, store())).rejects.toBeInstanceOf(ValidationError);

    authorization.role = "MANAGER";
    await expect(applyConfigurationImport({ content, digest, destinationDigest }, store())).rejects.toBeInstanceOf(AuthorizationError);
    authorization.role = "ADMIN";
  });
});

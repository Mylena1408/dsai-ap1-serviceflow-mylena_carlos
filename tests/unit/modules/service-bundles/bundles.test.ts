import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError, NotFoundError, ValidationError } from "@/server/errors";
import {
  assertBundleServices,
  availabilityText,
  bundleAvailability,
  bundleInputSchema,
  serviceProblems,
  type BundleRecord,
  type BundleServiceState,
} from "@/modules/service-bundles/domain/bundle";
import type { BundleTransaction } from "@/modules/service-bundles/application/bundles";

const authorization = vi.hoisted(() => ({ requireConfigurationAdministrator: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { createBundle, listBundleOverview, setBundleActive, updateBundle } from "@/modules/service-bundles/application/bundles";
import { BundlesSection, bundleServicesText, serviceOptionLabel } from "@/app/(admin)/admin/_sections/bundles/bundles-section";
import { announcement } from "@/app/(admin)/admin/_shared/announcement";
import { auditValueFormatter } from "@/app/(admin)/admin/_sections/audit/audit-section";

// SPEC 2026-11-07-operacao-e-automacao, 3.3 item 2 (SF-177; CA-VNC-04 by the rules and the screen).

const admin = { id: "00000000-0000-4000-8000-000000000001", role: "ADMIN" as const, isActive: true, sectorId: null };
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";
const B1 = "44444444-4444-4444-8444-444444444444";

const service = (id: string, overrides: Partial<BundleServiceState> = {}): BundleServiceState => ({
  id,
  name: `Serviço ${id.slice(0, 1)}`,
  sectorName: "TI",
  isActive: true,
  categoryActive: true,
  sectorActive: true,
  activeRequirements: 0,
  ...overrides,
});

const bundle = (overrides: Partial<BundleRecord> = {}): BundleRecord => ({
  id: B1,
  name: "Admissão",
  description: null,
  serviceIds: [S1, S2],
  isActive: true,
  ...overrides,
});

beforeEach(() => {
  authorization.requireConfigurationAdministrator.mockReset().mockResolvedValue(admin);
});

describe("bundle input (3.3 item 2)", () => {
  it("drops blank selects, keeps the order and trims the texts", () => {
    expect(bundleInputSchema.parse({ name: " Admissão ", description: "  ", serviceIds: [S2, "", S1, " "] })).toEqual({
      name: "Admissão",
      description: null,
      serviceIds: [S2, S1],
    });
  });

  it("refuses names and descriptions out of size, fewer than 2 or more than 5 services and repetition", () => {
    const many = Array.from({ length: 6 }, (_, index) => `${index}`.repeat(8) + "-1111-4111-8111-111111111111");
    for (const input of [
      { name: "", serviceIds: [S1, S2] },
      { name: "x".repeat(81), serviceIds: [S1, S2] },
      { name: "A", description: "x".repeat(501), serviceIds: [S1, S2] },
      { name: "A", serviceIds: [S1] },
      { name: "A", serviceIds: many },
      { name: "A", serviceIds: [S1, S1] },
      { name: "A", serviceIds: [S1, "not-an-id"] },
      { name: "A", serviceIds: [S1, S2], extra: true },
    ]) {
      expect(bundleInputSchema.safeParse(input).success).toBe(false);
    }
    expect(bundleInputSchema.safeParse({ name: "x".repeat(80), description: "y".repeat(500), serviceIds: many.slice(0, 5) }).success).toBe(true);
  });
});

describe("which services may be in a bundle (decision H5)", () => {
  it("says why a service may not", () => {
    expect(serviceProblems(service(S1))).toEqual([]);
    expect(serviceProblems(service(S1, { isActive: false, categoryActive: false, sectorActive: false, activeRequirements: 1 }))).toEqual([
      "inactive",
      "category_inactive",
      "sector_inactive",
      "documents",
    ]);
  });

  it("accepts only existing services that can be opened without documents", () => {
    expect(() => assertBundleServices([S1, S2], [service(S1), service(S2)])).not.toThrow();
    expect(() => assertBundleServices([S1, S3], [service(S1)])).toThrow(ValidationError);
    expect(() => assertBundleServices([S1, S2], [service(S1), service(S2, { activeRequirements: 2 })])).toThrow(ValidationError);
    expect(() => assertBundleServices([S1, S2], [service(S1), service(S2, { sectorActive: false })])).toThrow(ValidationError);
  });

  it("keeps a bundle in the catalog only while active and every service can be opened", () => {
    expect(bundleAvailability(bundle(), [service(S1), service(S2)])).toEqual({ openable: true, problems: [] });
    expect(bundleAvailability(bundle({ isActive: false }), [service(S1), service(S2)]).openable).toBe(false);
    const broken = bundleAvailability(bundle({ serviceIds: [S1, S2, S3] }), [service(S1), service(S2, { name: "Crachá", activeRequirements: 1 })]);
    expect(broken).toEqual({
      openable: false,
      problems: [
        { serviceId: S2, serviceName: "Crachá", problems: ["documents"] },
        { serviceId: S3, serviceName: "(serviço removido)", problems: ["inactive"] },
      ],
    });
    expect(availabilityText(broken)).toBe("Crachá (pede documentos); (serviço removido) (serviço inativo)");
    expect(availabilityText({ openable: true, problems: [] })).toBeNull();
  });
});

function store(current: BundleRecord | null = bundle(), states: BundleServiceState[] = [service(S1), service(S2)]) {
  const transaction: BundleTransaction = {
    audited: vi.fn(async (_meta, change) => change()),
    findBundle: vi.fn(async () => current),
    serviceStates: vi.fn(async () => states),
    createBundle: vi.fn(async (input) => ({ id: B1, isActive: true, ...input })),
    updateBundle: vi.fn(async (_id, data) => ({ ...bundle(), ...data })),
  };
  return { transaction, runner: { run: <T>(work: (t: BundleTransaction) => Promise<T>) => work(transaction) } };
}

describe("bundle use cases (3.3 item 2)", () => {
  it("only the administrator configures", async () => {
    authorization.requireConfigurationAdministrator.mockRejectedValue(new AuthorizationError());
    await expect(createBundle({ name: "A", serviceIds: [S1, S2] }, store().runner)).rejects.toThrow(AuthorizationError);
    await expect(listBundleOverview({ listBundles: vi.fn(), listServiceStates: vi.fn() })).rejects.toThrow(AuthorizationError);
  });

  it("creates and edits with the audit trail after checking the services", async () => {
    const { runner, transaction } = store();
    await createBundle({ name: "Admissão", serviceIds: [S2, S1] }, runner);
    expect(transaction.serviceStates).toHaveBeenCalledWith([S2, S1]);
    expect(transaction.createBundle).toHaveBeenCalledWith({ name: "Admissão", description: null, serviceIds: [S2, S1] });
    expect(transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "CREATED", entityType: "SERVICE_BUNDLE" }), expect.any(Function));

    await updateBundle(B1, { name: "Admissão", description: "Novo colaborador", serviceIds: [S1, S2] }, runner);
    expect(transaction.audited).toHaveBeenLastCalledWith(expect.objectContaining({ action: "UPDATED", entityId: B1 }), expect.any(Function));

    await expect(createBundle({ name: "A", serviceIds: [S1, S2] }, store(null, [service(S1), service(S2, { isActive: false })]).runner)).rejects.toThrow(
      ValidationError,
    );
    await expect(updateBundle(B1, { name: "A", serviceIds: [S1, S2] }, store(null).runner)).rejects.toThrow(NotFoundError);
  });

  it("deactivates and reactivates with the audit, and does nothing on the same state", async () => {
    const { runner, transaction } = store();
    await setBundleActive(B1, false, runner);
    expect(transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "DEACTIVATED" }), expect.any(Function));
    const back = store(bundle({ isActive: false }));
    await setBundleActive(B1, true, back.runner);
    expect(back.transaction.audited).toHaveBeenCalledWith(expect.objectContaining({ action: "REACTIVATED" }), expect.any(Function));
    const same = store();
    await setBundleActive(B1, true, same.runner);
    expect(same.transaction.audited).not.toHaveBeenCalled();
  });

  it("lists every bundle with its availability", async () => {
    const overview = await listBundleOverview({
      listBundles: vi.fn(async () => [bundle()]),
      listServiceStates: vi.fn(async () => [service(S1), service(S2, { isActive: false })]),
    });
    expect(overview.bundles[0].availability).toEqual({ openable: false, problems: [{ serviceId: S2, serviceName: "Serviço 2", problems: ["inactive"] }] });
  });
});

describe("the 'Pacotes' section", () => {
  const services = [service(S1, { name: "Acesso" }), service(S2, { name: "Crachá", activeRequirements: 1 }), service(S3, { name: "Mesa" })];

  it("offers the services in order, the ineligible ones disabled with the reason", () => {
    expect(serviceOptionLabel(services[0])).toBe("Acesso · TI");
    expect(serviceOptionLabel(services[1])).toBe("Crachá · TI (pede documentos)");
    expect(bundleServicesText(bundle({ serviceIds: [S3, S1] }), services)).toBe("Mesa → Acesso");

    const html = renderToStaticMarkup(
      createElement(BundlesSection, {
        overview: {
          services,
          bundles: [
            { ...bundle({ serviceIds: [S1, S3] }), availability: { openable: true, problems: [] } },
            {
              ...bundle({ id: "b2", name: "Mudança", serviceIds: [S1, S2] }),
              availability: { openable: false, problems: [{ serviceId: S2, serviceName: "Crachá", problems: ["documents"] }] },
            },
          ],
        },
      }),
    );
    expect(html).toContain('aria-label="Novo pacote"');
    expect(html).toContain(`<option disabled="" value="${S2}">Crachá · TI (pede documentos)</option>`);
    expect(html).toContain("Acesso → Mesa");
    expect(html).toContain(">No catálogo<");
    expect(html).toContain("Fora do catálogo por causa de: Crachá (pede documentos).");
    expect(renderToStaticMarkup(createElement(BundlesSection, { overview: { services, bundles: [] } }))).toContain("Nenhum pacote cadastrado.");
  });

  it("has fixed messages and shows the services of a bundle in the audit trail", () => {
    expect(announcement("validation", undefined, "bundles")).toContain("de 2 a 5 serviços diferentes");
    expect(announcement("dependency", undefined, "bundles")).toBe("Já existe um pacote ativo com esse nome.");
    expect(announcement(undefined, "created", "bundles")).toBe("Pacote criado.");
    expect(auditValueFormatter({ [S1]: "Acesso", [S2]: "Crachá" })("serviceIds", [S2, S1, "gone"])).toBe("Crachá → Acesso → (removido)");
  });
});

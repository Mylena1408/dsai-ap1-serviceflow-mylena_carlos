import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@/server/errors";
import { answersOf, bundleOpeningInputSchema, strayAnswers } from "@/modules/requests/domain/bundle-opening";
import type { BundleRecord, BundleServiceState } from "@/modules/service-bundles";

const authorization = vi.hoisted(() => ({ requirePublishedCatalogReader: vi.fn() }));
vi.mock("@/server/authorization", () => authorization);

import { getCatalogBundle, listCatalogBundles } from "@/modules/service-bundles/application/catalog";
import { BundleForm } from "@/app/(requester)/catalog/bundles/[bundleId]/bundle-form";
import { bundleErrorMessage } from "@/app/(requester)/catalog/bundles/[bundleId]/bundle-messages";
import { parseFieldErrors } from "@/app/(requester)/catalog/[serviceId]/field-errors";

// SPEC 2026-11-07-operacao-e-automacao, 3.3 items 2 and 3 (SF-178; CA-VNC-04 in the catalog and
// CA-VNC-05 by the rules and the screen).

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const B1 = "44444444-4444-4444-8444-444444444444";

describe("bundle opening input", () => {
  it("takes one description and the answers of every section", () => {
    expect(bundleOpeningInputSchema.parse({ bundleId: B1, description: " Novo colaborador ", fieldValues: { a: "x", b: ["1", "2"] } })).toEqual({
      bundleId: B1,
      description: "Novo colaborador",
      fieldValues: { a: "x", b: ["1", "2"] },
    });
    expect(bundleOpeningInputSchema.safeParse({ bundleId: B1, description: " " }).success).toBe(false);
    expect(bundleOpeningInputSchema.safeParse({ bundleId: B1, description: "x".repeat(10_001) }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 251 }, (_, index) => [`f${index}`, "x"]));
    expect(bundleOpeningInputSchema.safeParse({ bundleId: B1, description: "x", fieldValues: many }).success).toBe(false);
    expect(bundleOpeningInputSchema.safeParse({ bundleId: "x", description: "x" }).success).toBe(false);
  });

  it("splits the answers by the fields of each service and finds answers to no service", () => {
    const values = { a: "1", b: "2", c: "3" };
    expect(answersOf(values, new Set(["a", "c"]))).toEqual({ a: "1", c: "3" });
    expect(answersOf(values, new Set())).toEqual({});
    expect(strayAnswers(values, new Set(["a", "b"]))).toEqual(["c"]);
    expect(strayAnswers({}, new Set(["a"]))).toEqual([]);
  });
});

const state = (id: string, overrides: Partial<BundleServiceState> = {}): BundleServiceState => ({
  id,
  name: id === S1 ? "Acesso" : "Mesa",
  sectorName: id === S1 ? "TI" : "Facilities",
  isActive: true,
  categoryActive: true,
  sectorActive: true,
  activeRequirements: 0,
  ...overrides,
});

const bundle = (overrides: Partial<BundleRecord> = {}): BundleRecord => ({
  id: B1,
  name: "Admissão",
  description: "Novo colaborador",
  serviceIds: [S2, S1],
  isActive: true,
  ...overrides,
});

describe("bundles in the catalog (3.3 item 2, decision H20)", () => {
  beforeEach(() => {
    authorization.requirePublishedCatalogReader.mockReset().mockResolvedValue({ id: "rita", role: "REQUESTER" });
  });

  it("lists only bundles whose services can all be opened, with the services in order", async () => {
    const reader = {
      listActiveBundles: vi.fn(async () => [bundle(), bundle({ id: "b2", name: "Crachá", serviceIds: [S1, "33333333-3333-4333-8333-333333333333"] })]),
      findBundle: vi.fn(),
      serviceStates: vi.fn(async () => [state(S1), state(S2)]),
    };
    await expect(listCatalogBundles(reader)).resolves.toEqual([
      {
        id: B1,
        name: "Admissão",
        description: "Novo colaborador",
        services: [
          { id: S2, name: "Mesa", sectorName: "Facilities" },
          { id: S1, name: "Acesso", sectorName: "TI" },
        ],
      },
    ]);
  });

  it("finds an openable bundle and hides any other as not found", async () => {
    const reader = (found: BundleRecord | null, states = [state(S1), state(S2)]) => ({
      listActiveBundles: vi.fn(),
      findBundle: vi.fn(async () => found),
      serviceStates: vi.fn(async () => states),
    });
    await expect(getCatalogBundle(B1, reader(bundle()))).resolves.toMatchObject({ id: B1, services: [{ id: S2 }, { id: S1 }] });
    await expect(getCatalogBundle(B1, reader(null))).rejects.toThrow(NotFoundError);
    await expect(getCatalogBundle(B1, reader(bundle({ isActive: false })))).rejects.toThrow(NotFoundError);
    await expect(getCatalogBundle(B1, reader(bundle(), [state(S1), state(S2, { activeRequirements: 1 })]))).rejects.toThrow(NotFoundError);
    await expect(getCatalogBundle("not-an-id", reader(bundle()))).rejects.toThrow();
  });
});

describe("the bundle form", () => {
  it("has one description and one section per service, in order", () => {
    const noop = async (): Promise<never> => {
      throw new Error("not called");
    };
    const html = renderToStaticMarkup(
      createElement(BundleForm, {
        bundleId: B1,
        action: noop,
        fieldErrors: { "f-size": "required" },
        sections: [
          {
            serviceId: S2,
            serviceName: "Mesa",
            sectorName: "Facilities",
            fields: [
              { id: "f-size", label: "Tamanho", helpText: null, type: "SELECT", isRequired: true, options: ["P", "G"], minValue: null, maxValue: null },
            ],
          },
          { serviceId: S1, serviceName: "Acesso", sectorName: "TI", fields: [] },
        ],
      }),
    );
    expect(html).toContain(`name="bundleId" value="${B1}"`);
    expect(html.indexOf("1. Mesa")).toBeLessThan(html.indexOf("2. Acesso"));
    expect(html).toContain('name="field.f-size"');
    expect(html).toContain("Atendido por: Facilities");
    expect(html).toContain("Este serviço não pede informações adicionais.");
    expect(html).toContain("Enviar pacote");
  });

  it("says that a refusal opened nothing, and reads the field errors of every section", () => {
    expect(bundleErrorMessage("fields")).toContain("Nenhuma solicitação foi aberta.");
    expect(bundleErrorMessage("unavailable")).toContain("não está mais disponível");
    expect(bundleErrorMessage("fields-changed")).toContain("mudaram");
    expect(bundleErrorMessage(undefined)).toBeNull();
    expect(parseFieldErrors("a.required,b.invalid_email,c.unknown,zzz", new Set(["a", "b", "c"]))).toEqual({ a: "required", b: "invalid_email" });
  });
});

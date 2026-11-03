import { describe, expect, it, vi } from "vitest";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});
const schedule = vi.hoisted(() => ({ scheduleEventProcessing: vi.fn() }));
vi.mock("@/server/jobs/schedule", () => schedule);

import { generateApiToken } from "@/modules/api-tokens";
import { getServices, postRequest } from "@/modules/public-api";

// SPEC 2026-11-03-campos-condicionais-atendimento, 5.8.1 (SF-135; CA-CND-08, opening part). The
// session is not mocked here: the API reads the caller from the token.

describe("multiple choice and conditions through the API (SF-135)", () => {
  it("describes the condition in the catalog and accepts a list on opening", async () => {
    const sector = await createDomainSector();
    const category = await createDomainCategory();
    const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const rita = await createDomainUser({ role: "REQUESTER" });
    const field = (data: Record<string, unknown>) =>
      prisma.serviceField.create({ data: { serviceId: service.id, isRequired: true, options: [], ...data } as never });
    const kind = await field({ label: "Tipo", type: "SELECT", options: ["Notebook", "Desktop"], position: 0 });
    const devices = await field({ label: "Acessórios", type: "MULTI_SELECT", options: ["Mouse", "Teclado"], position: 1 });
    const charger = await field({ label: "Carregador", type: "SHORT_TEXT", position: 2, conditionFieldId: kind.id, conditionValue: "Notebook" });
    await field({ label: "Ordem", type: "SHORT_TEXT", position: 3, audience: "ATTENDANT" });

    const token = generateApiToken();
    const now = new Date();
    await prisma.apiToken.create({
      data: { userId: rita.id, name: "api", scope: "WRITE", tokenHash: token.hash, lastFour: token.lastFour, createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
    });
    const headers = { authorization: `Bearer ${token.value}`, "content-type": "application/json" };

    const catalog = await getServices(new Request("https://serviceflow.test/api/v1/services?pageSize=100", { headers }));
    expect(catalog.status).toBe(200);
    const items = (await catalog.json()).items as Array<{ id: string; fields: Array<{ label: string; condition: unknown }> }>;
    const fields = items.find(({ id }) => id === service.id)!.fields;
    // The attendance field is not in the requester's catalog (5.4.2).
    expect(fields.map(({ label }) => label)).toEqual(["Tipo", "Acessórios", "Carregador"]);
    expect(fields[2]!.condition).toEqual({ fieldId: kind.id, value: "Notebook" });
    expect(fields[0]!.condition).toBeNull();

    const response = await postRequest(
      new Request("https://serviceflow.test/api/v1/requests", {
        method: "POST",
        headers,
        body: JSON.stringify({ serviceId: service.id, description: "Pela API", fieldValues: { [kind.id]: "Notebook", [devices.id]: ["Teclado", "Mouse"], [charger.id]: "90 W" } }),
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.fieldAnswers.map(({ label, value }: { label: string; value: string }) => [label, value])).toEqual([
      ["Tipo", "Notebook"],
      ["Acessórios", '["Mouse","Teclado"]'],
      ["Carregador", "90 W"],
    ]);
  });
});

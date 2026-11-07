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

// SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3 through the API (SF-162; CA-CMP-04). The
// session is not mocked here: the API reads the caller from the token.

describe("decimal and formatted fields through the API (SF-162)", () => {
  it("describes the new types in the API catalog and validates them on opening (CA-CMP-04)", async () => {
    const sector = await createDomainSector();
    const category = await createDomainCategory();
    const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
    const rita = await createDomainUser({ role: "REQUESTER" });
    const price = await prisma.serviceField.create({
      data: { serviceId: service.id, label: "Valor estimado", type: "DECIMAL", isRequired: true, options: [], position: 0, decimalPlaces: 2, minDecimal: "0", maxDecimal: "1500.5" },
    });
    const cpf = await prisma.serviceField.create({
      data: { serviceId: service.id, label: "CPF", type: "CPF", isRequired: true, options: [], position: 1 },
    });
    const token = generateApiToken();
    const now = new Date();
    await prisma.apiToken.create({
      data: { userId: rita.id, name: "api", scope: "WRITE", tokenHash: token.hash, lastFour: token.lastFour, createdAt: now, expiresAt: new Date(now.getTime() + 86_400_000) },
    });
    const headers = { authorization: `Bearer ${token.value}`, "content-type": "application/json" };

    const catalog = await getServices(new Request("https://serviceflow.test/api/v1/services?pageSize=100", { headers }));
    const items = (await catalog.json()).items as Array<{ id: string; fields: Array<Record<string, unknown>> }>;
    const fields = items.find(({ id }) => id === service.id)!.fields;
    expect(fields.find(({ label }) => label === "Valor estimado")).toMatchObject({
      type: "DECIMAL",
      decimalPlaces: 2,
      minDecimal: "0.00",
      maxDecimal: "1500.50",
    });
    expect(fields.find(({ label }) => label === "CPF")).toMatchObject({ type: "CPF", decimalPlaces: null, minDecimal: null });

    const post = (fieldValues: Record<string, string>) =>
      postRequest(
        new Request("https://serviceflow.test/api/v1/requests", {
          method: "POST",
          headers,
          body: JSON.stringify({ serviceId: service.id, description: "Pela API", fieldValues }),
        }),
      );
    const refused = await post({ [price.id]: "abc", [cpf.id]: "52998224725" });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatchObject({ code: "invalid_request", fields: [{ fieldId: price.id, code: "not_decimal" }] });
    const created = await post({ [price.id]: "99.9", [cpf.id]: "529.982.247-25" });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.fieldAnswers.map(({ label, value }: { label: string; value: string }) => [label, value])).toEqual([
      ["Valor estimado", "99.90"],
      ["CPF", "52998224725"],
    ]);
  });
});

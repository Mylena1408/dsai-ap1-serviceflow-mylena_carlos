import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { ConflictError, NotFoundError } from "@/server/errors";
import { createMemoryDocumentStorage } from "@/server/storage";
import { createDomainSector, createDomainUser } from "./domain-fixtures";

// SPEC 2026-11-07-operacao-e-automacao, 7.3 item 1 and 7.4 (SF-191; CA-LOT-02 and 05).

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { deleteView, listSavedViews, renameView, saveView } from "@/modules/saved-views";
import { anonymizeUser } from "@/modules/users";

type Actor = { id: string; name: string; role: Role; sectorId: string | null; isActive: boolean };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, email: `${actor.id}@example.test` });

describe("saved views in the database (7.4; CA-LOT-05)", () => {
  it("the name has 1 to 40 characters without spaces at the ends, unique per person and list ignoring case; the criteria up to 1,000", async () => {
    const ana = await createDomainUser({ role: "REQUESTER" });
    const base = { userId: ana.id, list: "MY_REQUESTS" as const, criteria: "status=OPEN" };
    await prisma.savedView.create({ data: { ...base, name: "Abertas" } });
    await expect(prisma.savedView.create({ data: { ...base, name: "ABERTAS" } })).rejects.toMatchObject({ code: "P2002" });
    await expect(prisma.savedView.create({ data: { ...base, list: "QUEUE", name: "Abertas" } })).resolves.toMatchObject({ list: "QUEUE" });
    for (const data of [
      { ...base, name: "" },
      { ...base, name: " Espaço" },
      { ...base, name: "x".repeat(41) },
      { ...base, name: "Longa", criteria: "x".repeat(1_001) },
    ]) {
      await expect(prisma.savedView.create({ data })).rejects.toThrow(/SavedView_values_check/);
    }
  });
});

describe("saving, opening, renaming and deleting (7.3 item 1; CA-LOT-02)", () => {
  it("in both lists, each person only with their own views", async () => {
    const sector = await createDomainSector();
    const ana = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const bia = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
    const rita = await createDomainUser({ role: "REQUESTER" });

    actAs(ana);
    const queueView = await saveView({ list: "QUEUE", name: "Minhas abertas", criteria: "page=4&assignee=me&status=OPEN" });
    expect(queueView).toMatchObject({ list: "QUEUE", name: "Minhas abertas", criteria: "status=OPEN&assignee=me" });
    await expect(saveView({ list: "QUEUE", name: "minhas ABERTAS", criteria: "" })).rejects.toBeInstanceOf(ConflictError);
    await saveView({ list: "QUEUE", name: "Atrasadas", criteria: "sla=overdue" });
    expect((await listSavedViews("QUEUE")).map(({ name }) => name)).toEqual(["Atrasadas", "Minhas abertas"]);

    actAs(rita);
    await saveView({ list: "MY_REQUESTS", name: "Concluídas", criteria: "status=COMPLETED&assignee=me" });
    expect(await listSavedViews("MY_REQUESTS")).toEqual([expect.objectContaining({ name: "Concluídas", criteria: "status=COMPLETED" })]);

    // Another attendant sees none of Ana's views and cannot reach them.
    actAs(bia);
    expect(await listSavedViews("QUEUE")).toEqual([]);
    await expect(renameView(queueView.id, "Outra")).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteView(queueView.id)).rejects.toBeInstanceOf(NotFoundError);

    actAs(ana);
    await renameView(queueView.id, "Abertas comigo");
    await expect(renameView(queueView.id, "atrasadas")).rejects.toBeInstanceOf(ConflictError);
    await deleteView(queueView.id);
    expect((await listSavedViews("QUEUE")).map(({ name }) => name)).toEqual(["Atrasadas"]);
  });

  it("allows 20 views per person and list", async () => {
    const rita = await createDomainUser({ role: "REQUESTER" });
    await prisma.savedView.createMany({ data: Array.from({ length: 19 }, (_, index) => ({ userId: rita.id, list: "MY_REQUESTS" as const, name: `Visão ${index}`, criteria: "" })) });
    actAs(rita);
    await saveView({ list: "MY_REQUESTS", name: "A vigésima", criteria: "" });
    await expect(saveView({ list: "MY_REQUESTS", name: "A vigésima primeira", criteria: "" })).rejects.toMatchObject({ issues: [{ path: [], code: "too_big" }] });
  });

  it("anonymizing a person deletes their views (they may hold search terms)", async () => {
    const admin = await createDomainUser({ role: "ADMIN" });
    // Only a deactivated person is anonymized.
    const rita = await createDomainUser({ role: "REQUESTER", isActive: false });
    await prisma.savedView.create({ data: { userId: rita.id, list: "MY_REQUESTS", name: "Meu nome", criteria: "q=Rita+Silva" } });
    actAs(admin);
    await anonymizeUser({ userId: rita.id, confirmed: true }, prisma, createMemoryDocumentStorage());
    expect(await prisma.savedView.count({ where: { userId: rita.id } })).toBe(0);
  });
});

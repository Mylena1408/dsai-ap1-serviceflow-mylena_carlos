import { describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "./fixtures";
import { createDomainCategory, createDomainSector, createDomainService, createDomainUser } from "./domain-fixtures";

const session = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock("@/server/auth", () => session);
vi.mock("@/server/db", async () => {
  const { prisma } = await import("./fixtures");
  return { prisma };
});

import { createArticle, deleteArticle, listArticlesForEditor, listPublishedArticles, setArticlePublished, updateArticle } from "@/modules/knowledge";
import { AuthorizationError, ConflictError, NotFoundError } from "@/server/errors";

// SPEC 2026-11-06-base-conhecimento over the database (SF-156; CA-KB-01 to 04).

type Actor = { id: string; name: string; email: string; role: Role; sectorId: string | null };
const actAs = (actor: Actor) => session.getCurrentUser.mockResolvedValue({ ...actor, isActive: true });

async function scenario() {
  const sector = await createDomainSector();
  const otherSector = await createDomainSector();
  const category = await createDomainCategory();
  const service = await createDomainService({ categoryId: category.id, sectorId: sector.id });
  const otherService = await createDomainService({ categoryId: category.id, sectorId: otherSector.id });
  const admin = await createDomainUser({ role: "ADMIN" });
  const holder = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  await prisma.userPermission.create({ data: { userId: holder.id, permission: "SECTOR_SERVICES", grantedById: admin.id, grantedAt: new Date() } });
  const attendant = await createDomainUser({ role: "ATTENDANT", sectorId: sector.id });
  const rita = await createDomainUser({ role: "REQUESTER" });
  return { sector, service, otherService, admin, holder, attendant, rita };
}

describe("knowledge schema (CA-KB-02)", () => {
  it("refuses a repeated title in a service, ignoring case, and values out of limits", async () => {
    const { service, admin } = await scenario();
    const row = (data: Record<string, unknown>) =>
      prisma.knowledgeArticle.create({
        data: { serviceId: service.id, title: "Senha", body: "Texto", createdById: admin.id, updatedById: admin.id, createdAt: new Date(), updatedAt: new Date(), ...data },
      });
    await expect(row({ title: "" })).rejects.toThrow();
    await expect(row({ title: "Senha " })).rejects.toThrow();
    await expect(row({ title: "x".repeat(161) })).rejects.toThrow();
    await expect(row({ body: "" })).rejects.toThrow();
    await expect(row({ position: 1000 })).rejects.toThrow();
    await expect(row({ position: -1 })).rejects.toThrow();
    await expect(row({})).resolves.toMatchObject({ isPublished: false, position: 999 });
    await expect(row({ title: "SENHA" })).rejects.toThrow();
  });
});

describe("knowledge use cases (CA-KB-01, 03 and 04)", () => {
  it("lets the administrator write, publish, unpublish and delete a draft, with every change audited", async () => {
    const { service, admin, rita } = await scenario();
    actAs(admin);
    const { id } = await createArticle(service.id, { title: "Como redefinir a senha", body: "Abra a página.\n\nSiga os passos.", position: 1 }, prisma);
    await expect(createArticle(service.id, { title: "como redefinir a senha", body: "Outro" }, prisma)).rejects.toThrow(ConflictError);
    await updateArticle(id, { title: "Como redefinir a senha", body: "Texto revisado.", position: 2 }, prisma);

    actAs(rita);
    expect(await listPublishedArticles(service.id, prisma)).toEqual([]);

    actAs(admin);
    await setArticlePublished(id, true, prisma);
    await expect(deleteArticle(id, prisma)).rejects.toThrow(ConflictError);
    actAs(rita);
    expect((await listPublishedArticles(service.id, prisma)).map(({ title, body }) => [title, body])).toEqual([["Como redefinir a senha", "Texto revisado."]]);

    actAs(admin);
    await setArticlePublished(id, false, prisma);
    await deleteArticle(id, prisma);
    await expect(prisma.knowledgeArticle.count({ where: { id } })).resolves.toBe(0);

    const audit = await prisma.auditEntry.findMany({ where: { entityType: "KNOWLEDGE_ARTICLE", entityId: id }, orderBy: { occurredAt: "asc" } });
    expect(audit.map(({ action }) => action)).toEqual(["CREATED", "UPDATED", "UPDATED", "UPDATED", "DELETED"]);
    // The long text is recorded as changed, never copied.
    expect(JSON.stringify(audit)).not.toContain("Texto revisado.");
  });

  it("limits a holder of \"Gerir serviços do setor\" to the own sector and refuses others", async () => {
    const { service, otherService, holder, attendant, admin } = await scenario();
    actAs(admin);
    const foreign = await createArticle(otherService.id, { title: "Outro setor", body: "x" }, prisma);

    actAs(holder);
    await createArticle(service.id, { title: "Crachá", body: "Traga o antigo." }, prisma);
    await expect(createArticle(otherService.id, { title: "x", body: "y" }, prisma)).rejects.toThrow(NotFoundError);
    await expect(setArticlePublished(foreign.id, true, prisma)).rejects.toThrow(NotFoundError);
    expect((await listArticlesForEditor(prisma)).map(({ id }) => id)).toEqual([service.id]);

    actAs(attendant);
    await expect(listArticlesForEditor(prisma)).rejects.toThrow(AuthorizationError);
  });

  it("hides the articles of an inactive service from requesters", async () => {
    const { service, admin, rita } = await scenario();
    actAs(admin);
    const { id } = await createArticle(service.id, { title: "Aviso", body: "Texto" }, prisma);
    await setArticlePublished(id, true, prisma);
    await prisma.service.update({ where: { id: service.id }, data: { isActive: false } });
    actAs(rita);
    expect(await listPublishedArticles(service.id, prisma)).toEqual([]);
  });
});

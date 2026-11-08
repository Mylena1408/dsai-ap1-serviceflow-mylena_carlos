import { Prisma, type PrismaClient } from "@prisma/client";
import type { SavedViewStore } from "../application/saved-views";

// Saved views in PostgreSQL (SPEC 2026-11-07-operacao-e-automacao, 7.4): the unique index on (person, list,
// name) compares names ignoring case (citext) and refuses a repeated one; the CHECK bounds the name and the
// criteria.

const columns = { id: true, list: true, name: true, criteria: true } as const;

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export function createPrismaSavedViewStore(database: PrismaClient): SavedViewStore {
  return {
    list(userId, list) {
      return database.savedView.findMany({ where: { userId, list }, select: columns, orderBy: [{ name: "asc" }, { id: "asc" }] });
    },
    count(userId, list) {
      return database.savedView.count({ where: { userId, list } });
    },
    find(viewId) {
      return database.savedView.findUnique({ where: { id: viewId }, select: { ...columns, userId: true } });
    },
    async create(view) {
      try {
        return await database.savedView.create({ data: view, select: columns });
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },
    async rename(viewId, name) {
      try {
        await database.savedView.update({ where: { id: viewId }, data: { name } });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },
    async remove(viewId) {
      await database.savedView.delete({ where: { id: viewId } });
    },
  };
}

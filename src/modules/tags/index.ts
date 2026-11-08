import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db";
import * as sectorTags from "./application/sector-tags";
import { createPrismaSectorTagReader, createPrismaSectorTagStore } from "./infrastructure/prisma-sector-tags";

// Sectors' tags (SPEC 2026-11-08-atendimento-dia-a-dia, part A): the rules, and the configuration of each
// sector's tags (SF-195). The tags on requests arrive in SF-196.
export {
  MAX_ACTIVE_TAGS_PER_SECTOR,
  MAX_TAGS_PER_REQUEST,
  MAX_TAG_NAME_LENGTH,
  TAG_COLORS,
  TAG_COLOR_KEYS,
  assertTagRoom,
  canManageSectorTags,
  contrastRatio,
  planTagChange,
  tagInputSchema,
  type TagActor,
  type TagColor,
  type TagInput,
  type TagRecord,
  type TaggableRequest,
} from "./domain/tag";
export type { SectorTags } from "./application/sector-tags";

export function listSectorTags(database: PrismaClient = prisma): Promise<sectorTags.SectorTags[]> {
  return sectorTags.listSectorTags(createPrismaSectorTagReader(database));
}

export function createSectorTag(sectorId: unknown, input: unknown, database: PrismaClient = prisma) {
  return sectorTags.createSectorTag(sectorId, input, createPrismaSectorTagStore(database));
}

export function updateSectorTag(tagId: unknown, input: unknown, database: PrismaClient = prisma) {
  return sectorTags.updateSectorTag(tagId, input, createPrismaSectorTagStore(database));
}

export function setSectorTagActive(tagId: unknown, isActive: unknown, database: PrismaClient = prisma) {
  return sectorTags.setSectorTagActive(tagId, isActive, createPrismaSectorTagStore(database));
}

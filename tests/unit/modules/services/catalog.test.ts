import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/authorization", () => ({
  requirePublishedCatalogReader: vi.fn().mockResolvedValue({
    id: "requester",
    role: "REQUESTER",
    sectorId: null,
    isActive: true,
  }),
}));

import {
  groupPublishedServices,
  type PublishedService,
} from "@/modules/services/domain/service";

function service(
  id: string,
  category: string,
  name: string,
): PublishedService {
  return {
    id,
    name,
    description: `${name} description`,
    categoryId: `category-${category}`,
    sectorId: `sector-${id}`,
    isActive: true,
    defaultPriority: "NORMAL",
    slaHours: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    category: { id: `category-${category}`, name: category },
    sector: { id: `sector-${id}`, name: `Sector ${id}` },
  };
}

describe("published service grouping", () => {
  it("groups the filtered database results by current category name in input order", () => {
    const grouped = groupPublishedServices([
      service("1", "General", "Identity card"),
      service("2", "Facilities", "Room setup"),
      service("3", "General", "Access request"),
    ]);

    expect([...grouped.keys()]).toEqual(["General", "Facilities"]);
    expect(grouped.get("General")?.map(({ name }) => name)).toEqual([
      "Identity card",
      "Access request",
    ]);
  });
});

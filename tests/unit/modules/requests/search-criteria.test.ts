import { describe, expect, it } from "vitest";
import { ValidationError } from "@/server/errors";
import {
  escapeLikePattern,
  pageWindow,
  parseSearchCriteria,
  startOfDayInTimeZone,
} from "@/modules/requests/domain/search-criteria";

// SPEC 2026-10-31-busca-filtros-paginacao, section 5 (SF-057).

function rejected(run: () => unknown) {
  expect(run).toThrow(ValidationError);
  try {
    run();
  } catch (error) {
    expect((error as ValidationError).issues[0].path).toEqual(["search"]);
  }
}

describe("search criteria", () => {
  it("uses each list's current order and no filters by default (CA-BUS-07)", () => {
    expect(parseSearchCriteria({}, "requester")).toEqual({
      term: null,
      statuses: [],
      assignee: "all",
      openedFrom: null,
      openedBefore: null,
      order: "newest",
      page: 1,
    });
    expect(parseSearchCriteria({}, "attendant").order).toBe("oldest");
    expect(parseSearchCriteria({ order: "newest" }, "attendant").order).toBe("newest");
  });

  it("trims the term and enforces 2 to 100 characters (CA-BUS-03)", () => {
    expect(parseSearchCriteria({ q: "  cadeira  " }, "requester").term).toBe("cadeira");
    expect(parseSearchCriteria({ q: "   " }, "requester").term).toBeNull();
    expect(parseSearchCriteria({ q: "é".repeat(100) }, "requester").term).toHaveLength(100);
    rejected(() => parseSearchCriteria({ q: "a" }, "requester"));
    rejected(() => parseSearchCriteria({ q: "a".repeat(101) }, "requester"));
  });

  it("accepts one or more known statuses and rejects unknown ones (CA-BUS-04)", () => {
    expect(parseSearchCriteria({ status: "OPEN" }, "attendant").statuses).toEqual(["OPEN"]);
    expect(parseSearchCriteria({ status: ["OPEN", "IN_PROGRESS", "OPEN", ""] }, "attendant").statuses).toEqual([
      "OPEN",
      "IN_PROGRESS",
    ]);
    rejected(() => parseSearchCriteria({ status: ["OPEN", "DELETED"] }, "attendant"));
  });

  it("offers the assignee filter to attendants only (CA-BUS-05)", () => {
    expect(parseSearchCriteria({ assignee: "mine" }, "attendant").assignee).toBe("mine");
    expect(parseSearchCriteria({ assignee: "unassigned" }, "attendant").assignee).toBe("unassigned");
    expect(parseSearchCriteria({ assignee: "mine" }, "requester").assignee).toBe("all");
    rejected(() => parseSearchCriteria({ assignee: "everyone" }, "attendant"));
  });

  it("converts the opening period to São Paulo days, inclusive (CA-BUS-06)", () => {
    const criteria = parseSearchCriteria({ from: "2026-10-01", to: "2026-10-31" }, "requester");

    expect(criteria.openedFrom?.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(criteria.openedBefore?.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    const sameDay = parseSearchCriteria({ from: "2026-10-31", to: "2026-10-31" }, "requester");
    expect(sameDay.openedBefore!.getTime() - sameDay.openedFrom!.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("rejects invalid dates and an inverted period (CA-BUS-06)", () => {
    for (const raw of [{ from: "2026-02-30" }, { to: "31/10/2026" }, { from: "2026-10-31", to: "2026-10-30" }]) {
      rejected(() => parseSearchCriteria(raw, "requester"));
    }
  });

  it("follows daylight saving in other zones (helper correctness)", () => {
    expect(startOfDayInTimeZone("2026-07-01", "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(startOfDayInTimeZone("2026-12-01", "America/New_York").toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });

  it("treats anything but a positive integer as page 1 and ignores unknown parameters", () => {
    for (const page of ["0", "-2", "abc", "1.5", "", undefined, "9999999"]) {
      expect(parseSearchCriteria({ page }, "requester").page).toBe(1);
    }
    expect(parseSearchCriteria({ page: "3", requesterId: "x", sectorId: "y" }, "requester").page).toBe(3);
  });
});

describe("page window (CA-BUS-08)", () => {
  it("pages by 20 and clamps to the last page", () => {
    expect(pageWindow(0, 1)).toEqual({ page: 1, pageCount: 1, skip: 0, take: 20 });
    expect(pageWindow(20, 2)).toEqual({ page: 1, pageCount: 1, skip: 0, take: 20 });
    expect(pageWindow(21, 2)).toEqual({ page: 2, pageCount: 2, skip: 20, take: 20 });
    expect(pageWindow(45, 99)).toEqual({ page: 3, pageCount: 3, skip: 40, take: 20 });
  });
});

describe("LIKE escaping (CA-BUS-02)", () => {
  it("turns wildcards and the escape character into plain text", () => {
    expect(escapeLikePattern("100%_ok\\")).toBe("100\\%\\_ok\\\\");
    expect(escapeLikePattern("cadeira")).toBe("cadeira");
  });
});

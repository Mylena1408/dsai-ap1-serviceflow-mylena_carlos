import { describe, expect, it } from "vitest";
import { hasSearchCriteria, searchPageHref } from "@/app/_components/request-search-url";

// SPEC 2026-10-31-busca-filtros-paginacao, sections 5.5 and 5.6 (SF-059).

describe("search page links (CA-BUS-09)", () => {
  it("keeps the known criteria, drops unknown ones and sets the page", () => {
    expect(
      searchPageHref(
        "/queue",
        { q: "cadeira", status: ["OPEN", "IN_PROGRESS"], assignee: "mine", order: "oldest", page: "1", sectorId: "x" },
        2,
      ),
    ).toBe("/queue?q=cadeira&status=OPEN&status=IN_PROGRESS&assignee=mine&order=oldest&page=2");
  });

  it("omits page 1 and empty values", () => {
    expect(searchPageHref("/requests", { q: "", from: "2026-10-01", page: "3" }, 1)).toBe("/requests?from=2026-10-01");
    expect(searchPageHref("/requests", {}, 1)).toBe("/requests");
  });

  it("encodes the term", () => {
    expect(searchPageHref("/requests", { q: "100% & mais" }, 2)).toBe("/requests?q=100%25+%26+mais&page=2");
  });

  it("tells whether any criterion besides page and order is present", () => {
    expect(hasSearchCriteria({})).toBe(false);
    expect(hasSearchCriteria({ order: "oldest", page: "2", assignee: "all", q: "" })).toBe(false);
    expect(hasSearchCriteria({ status: ["", "OPEN"] })).toBe(true);
    expect(hasSearchCriteria({ assignee: "unassigned" })).toBe(true);
    expect(hasSearchCriteria({ to: "2026-10-31" })).toBe(true);
  });
});

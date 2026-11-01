import { describe, expect, it } from "vitest";
import { formatFieldAnswer } from "@/modules/service-fields/domain/field-value";

// SPEC 2026-11-01-campos-personalizados, section 5.4.3 (SF-074).

describe("formatFieldAnswer (SF-074)", () => {
  it("shows dates as DD/MM/AAAA", () => {
    expect(formatFieldAnswer("DATE", "2026-12-01")).toBe("01/12/2026");
    expect(formatFieldAnswer("DATE", "1900-01-31")).toBe("31/01/1900");
  });

  it("shows yes/no answers as Sim or Não", () => {
    expect(formatFieldAnswer("YES_NO", "true")).toBe("Sim");
    expect(formatFieldAnswer("YES_NO", "false")).toBe("Não");
  });

  it("groups integer digits the Brazilian way", () => {
    expect(formatFieldAnswer("INTEGER", "1234567")).toBe("1.234.567");
    expect(formatFieldAnswer("INTEGER", "-42")).toBe("-42");
    expect(formatFieldAnswer("INTEGER", "0")).toBe("0");
  });

  it("shows text and list answers as stored", () => {
    expect(formatFieldAnswer("SHORT_TEXT", "PAT-0042")).toBe("PAT-0042");
    expect(formatFieldAnswer("LONG_TEXT", "Linha 1\nLinha 2")).toBe("Linha 1\nLinha 2");
    expect(formatFieldAnswer("SELECT", "Tarde")).toBe("Tarde");
  });

  it("shows unexpected stored values unchanged instead of guessing", () => {
    expect(formatFieldAnswer("DATE", "01/12/2026")).toBe("01/12/2026");
    expect(formatFieldAnswer("YES_NO", "talvez")).toBe("talvez");
    expect(formatFieldAnswer("INTEGER", "1.5")).toBe("1.5");
  });
});

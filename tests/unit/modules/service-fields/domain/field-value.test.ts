import { describe, expect, it } from "vitest";
import {
  collectFieldAnswers,
  normalizeFieldValue,
  type AnswerableField,
} from "@/modules/service-fields/domain/field-value";

// SPEC 2026-11-01-campos-personalizados, sections 5.2 to 5.4 (SF-071; rules of CA-FLD-05 and 06).

function field(overrides: Partial<AnswerableField> = {}): AnswerableField {
  return {
    id: "field-1",
    label: "Campo",
    type: "SHORT_TEXT",
    isRequired: false,
    options: [],
    minValue: null,
    maxValue: null,
    position: 0,
    ...overrides,
  };
}

describe("normalizeFieldValue (SF-071)", () => {
  it("requires a value only on required fields, counting blanks as empty", () => {
    for (const raw of [undefined, null, "", "   ", "\r\n"]) {
      expect(normalizeFieldValue(field({ isRequired: true }), raw)).toEqual({ ok: false, code: "required" });
      expect(normalizeFieldValue(field(), raw)).toEqual({ ok: true, value: null });
    }
  });

  it("trims short text, keeps 200 characters and refuses 201 or a line break", () => {
    const shortText = field();

    expect(normalizeFieldValue(shortText, "  Sala 2  ")).toEqual({ ok: true, value: "Sala 2" });
    expect(normalizeFieldValue(shortText, "a".repeat(200))).toEqual({ ok: true, value: "a".repeat(200) });
    expect(normalizeFieldValue(shortText, "a".repeat(201))).toEqual({ ok: false, code: "too_long" });
    expect(normalizeFieldValue(shortText, "linha 1\nlinha 2")).toEqual({ ok: false, code: "line_break" });
  });

  it("counts characters, not UTF-16 units, like PostgreSQL", () => {
    expect(normalizeFieldValue(field(), "🙂".repeat(200))).toEqual({ ok: true, value: "🙂".repeat(200) });
    expect(normalizeFieldValue(field(), "🙂".repeat(201))).toEqual({ ok: false, code: "too_long" });
  });

  it("keeps 2,000 characters of long text, with CRLF counted as one line break", () => {
    const longText = field({ type: "LONG_TEXT" });

    expect(normalizeFieldValue(longText, "a".repeat(2000))).toEqual({ ok: true, value: "a".repeat(2000) });
    expect(normalizeFieldValue(longText, "a".repeat(2001))).toEqual({ ok: false, code: "too_long" });
    expect(normalizeFieldValue(longText, `${"a".repeat(999)}\r\n${"b".repeat(1000)}`)).toEqual({
      ok: true,
      value: `${"a".repeat(999)}\n${"b".repeat(1000)}`,
    });
  });

  it("accepts integers within the configured limits, or within one billion without limits", () => {
    const limited = field({ type: "INTEGER", minValue: 1, maxValue: 10 });
    const unlimited = field({ type: "INTEGER" });

    expect(normalizeFieldValue(limited, "1")).toEqual({ ok: true, value: "1" });
    expect(normalizeFieldValue(limited, "10")).toEqual({ ok: true, value: "10" });
    expect(normalizeFieldValue(limited, "0")).toEqual({ ok: false, code: "out_of_range" });
    expect(normalizeFieldValue(limited, "11")).toEqual({ ok: false, code: "out_of_range" });
    expect(normalizeFieldValue(unlimited, "-1000000000")).toEqual({ ok: true, value: "-1000000000" });
    expect(normalizeFieldValue(unlimited, "1000000001")).toEqual({ ok: false, code: "out_of_range" });
    expect(normalizeFieldValue(unlimited, "007")).toEqual({ ok: true, value: "7" });
    expect(normalizeFieldValue(unlimited, "-0")).toEqual({ ok: true, value: "0" });
    expect(normalizeFieldValue(field({ type: "INTEGER", minValue: 5 }), "4")).toEqual({
      ok: false,
      code: "out_of_range",
    });
  });

  it("refuses numbers that are not integers in base 10", () => {
    for (const raw of ["1.5", "1,5", "1e3", "+3", "0x10", "abc", "- 1"]) {
      expect(normalizeFieldValue(field({ type: "INTEGER" }), raw)).toEqual({ ok: false, code: "not_integer" });
    }
  });

  it("accepts calendar dates from 1900-01-01 to 2100-12-31", () => {
    const date = field({ type: "DATE" });

    expect(normalizeFieldValue(date, "2028-02-29")).toEqual({ ok: true, value: "2028-02-29" });
    expect(normalizeFieldValue(date, "1900-01-01")).toEqual({ ok: true, value: "1900-01-01" });
    expect(normalizeFieldValue(date, "2100-12-31")).toEqual({ ok: true, value: "2100-12-31" });
    expect(normalizeFieldValue(date, "1899-12-31")).toEqual({ ok: false, code: "out_of_range" });
    expect(normalizeFieldValue(date, "2101-01-01")).toEqual({ ok: false, code: "out_of_range" });
    for (const raw of ["2026-02-30", "2027-02-29", "2026-13-01", "31/10/2026", "2026-1-5"]) {
      expect(normalizeFieldValue(date, raw)).toEqual({ ok: false, code: "invalid_date" });
    }
  });

  it("accepts only one of the current options of a list, exactly as written", () => {
    const list = field({ type: "SELECT", options: ["Manhã", "Tarde"] });

    expect(normalizeFieldValue(list, "Tarde")).toEqual({ ok: true, value: "Tarde" });
    expect(normalizeFieldValue(list, "tarde")).toEqual({ ok: false, code: "invalid_option" });
    expect(normalizeFieldValue(list, "Noite")).toEqual({ ok: false, code: "invalid_option" });
  });

  it("accepts only true or false on yes/no fields", () => {
    const yesNo = field({ type: "YES_NO", isRequired: true });

    expect(normalizeFieldValue(yesNo, "true")).toEqual({ ok: true, value: "true" });
    expect(normalizeFieldValue(yesNo, "false")).toEqual({ ok: true, value: "false" });
    expect(normalizeFieldValue(yesNo, "sim")).toEqual({ ok: false, code: "invalid_choice" });
    expect(normalizeFieldValue(yesNo, "")).toEqual({ ok: false, code: "required" });
  });
});

describe("collectFieldAnswers (SF-071)", () => {
  const fields: AnswerableField[] = [
    field({ id: "b", label: "Turno", type: "SELECT", options: ["Manhã", "Tarde"], position: 3, isRequired: true }),
    field({ id: "a", label: "Patrimônio", position: 1 }),
    field({ id: "c", label: "Data", type: "DATE", position: 5 }),
  ];

  it("returns answers in the configured order with snapshots, skipping blank optional fields", () => {
    const result = collectFieldAnswers(
      fields,
      new Map([
        ["b", "Tarde"],
        ["a", " 1234 "],
        ["c", ""],
      ]),
    );

    expect(result).toEqual({
      ok: true,
      answers: [
        { fieldId: "a", labelSnapshot: "Patrimônio", typeSnapshot: "SHORT_TEXT", positionSnapshot: 0, value: "1234" },
        { fieldId: "b", labelSnapshot: "Turno", typeSnapshot: "SELECT", positionSnapshot: 1, value: "Tarde" },
      ],
    });
  });

  it("treats a missing required field as an error and reports every invalid field", () => {
    expect(collectFieldAnswers(fields, new Map([["c", "2026-02-30"]]))).toEqual({
      ok: false,
      reason: "invalid",
      errors: [
        { fieldId: "b", code: "required" },
        { fieldId: "c", code: "invalid_date" },
      ],
    });
  });

  it("refuses answers for fields that are not active on the service as an out-of-date form", () => {
    expect(
      collectFieldAnswers(
        fields,
        new Map([
          ["b", "Tarde"],
          ["inactive-or-other-service", "x"],
        ]),
      ),
    ).toEqual({ ok: false, reason: "stale_form" });
  });

  it("gives no answers for a service without fields", () => {
    expect(collectFieldAnswers([], new Map())).toEqual({ ok: true, answers: [] });
    expect(collectFieldAnswers([], new Map([["x", "1"]]))).toEqual({ ok: false, reason: "stale_form" });
  });
});

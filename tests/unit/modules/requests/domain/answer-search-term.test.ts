import { describe, expect, it } from "vitest";
import { DIGIT_ANSWER_TYPES, digitsSearchTerm } from "@/modules/requests/domain/search-criteria";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.5 (SF-163).

describe("digitsSearchTerm (SF-163)", () => {
  it("keeps the digits of a term written with digits and the usual punctuation", () => {
    expect(digitsSearchTerm("123.456")).toBe("123456");
    expect(digitsSearchTerm("529.982.247-25")).toBe("52998224725");
    expect(digitsSearchTerm("(91) 98765-4321")).toBe("91987654321");
    expect(digitsSearchTerm("11.222.333/0001")).toBe("112223330001");
    expect(digitsSearchTerm("66075")).toBe("66075");
  });

  it("is null for terms with letters or other symbols, and for fewer than 2 digits", () => {
    expect(digitsSearchTerm("PAT-1203")).toBeNull();
    expect(digitsSearchTerm("50%")).toBeNull();
    expect(digitsSearchTerm("+55 91")).toBeNull();
    expect(digitsSearchTerm("1.")).toBeNull();
    expect(digitsSearchTerm("..")).toBeNull();
  });

  it("covers exactly the types stored as digits", () => {
    expect([...DIGIT_ANSWER_TYPES]).toEqual(["PHONE", "CPF", "CNPJ", "CEP"]);
  });
});

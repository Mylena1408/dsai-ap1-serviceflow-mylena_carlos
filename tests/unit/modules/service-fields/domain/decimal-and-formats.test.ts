import { describe, expect, it } from "vitest";
import {
  decimalWithinBound,
  formatDecimalForDisplay,
  formatScaledDecimal,
  parseDecimal,
} from "@/modules/service-fields/domain/decimal";
import {
  formatFormattedValue,
  isValidCnpj,
  isValidCpf,
  normalizeCep,
  normalizeCnpj,
  normalizeCpf,
  normalizeEmail,
  normalizePhone,
} from "@/modules/service-fields/domain/formatted-values";

// SPEC 2026-11-06-aprofundamento-configurabilidade, 3.3.1 and 3.3.2 (SF-161).

describe("decimal numbers (SF-161)", () => {
  it("reads comma or dot, a sign and up to 4 places, as an exact scaled integer", () => {
    expect(parseDecimal("1234,5")).toEqual({ scaled: BigInt(12_345_000), places: 1 });
    expect(parseDecimal("-0.25")).toEqual({ scaled: BigInt(-2_500), places: 2 });
    expect(parseDecimal("10")).toEqual({ scaled: BigInt(100_000), places: 0 });
    // 0.1 + 0.2 is not 0.30000000000000004 here.
    expect(parseDecimal("0.1")!.scaled + parseDecimal("0.2")!.scaled).toBe(parseDecimal("0.3")!.scaled);
  });

  it("refuses thousands separators, exponents, spaces and a separator without digits", () => {
    for (const text of ["1.234,50", "1,234.50", "1e3", "1 000", "1,", ",5", "+1", "--1", "abc", ""]) {
      expect(parseDecimal(text)).toBeNull();
    }
  });

  it("reports the places written beyond 4 so the caller refuses them without rounding", () => {
    expect(parseDecimal("1,23456")?.places).toBe(5);
  });

  it("keeps the bound of ±1,000,000,000", () => {
    expect(decimalWithinBound(parseDecimal("1000000000")!.scaled)).toBe(true);
    expect(decimalWithinBound(parseDecimal("-1000000000")!.scaled)).toBe(true);
    expect(decimalWithinBound(parseDecimal("1000000000,0001")!.scaled)).toBe(false);
    // More than 10 integer digits is not a decimal at all.
    expect(parseDecimal("10000000000")).toBeNull();
  });

  it("stores exactly the field's places with a dot", () => {
    expect(formatScaledDecimal(parseDecimal("1234,5")!.scaled, 2)).toBe("1234.50");
    expect(formatScaledDecimal(parseDecimal("-0,5")!.scaled, 1)).toBe("-0.5");
    expect(formatScaledDecimal(parseDecimal("-0")!.scaled, 2)).toBe("0.00");
    expect(formatScaledDecimal(parseDecimal("7")!.scaled, 4)).toBe("7.0000");
  });

  it("shows the Brazilian format", () => {
    expect(formatDecimalForDisplay("1234.50")).toBe("1.234,50");
    expect(formatDecimalForDisplay("-1000000000.0")).toBe("-1.000.000.000,0");
    expect(formatDecimalForDisplay("0.25")).toBe("0,25");
    expect(formatDecimalForDisplay("texto")).toBe("texto");
  });
});

describe("e-mail (SF-161)", () => {
  it("accepts one @ and a domain with a dot, stored in lowercase", () => {
    expect(normalizeEmail("Maria.Souza@Exemplo.com.BR")).toBe("maria.souza@exemplo.com.br");
    expect(normalizeEmail("a@b.co")).toBe("a@b.co");
  });

  it("refuses spaces, missing or repeated @, domains without a dot or with empty labels, and long addresses", () => {
    for (const text of ["maria souza@exemplo.com", "maria.exemplo.com", "a@@b.com", "a@b@c.com", "@exemplo.com", "maria@exemplo", "maria@.com", "maria@exemplo..com", "maria@exemplo.com."]) {
      expect(normalizeEmail(text), text).toBeNull();
    }
    expect(normalizeEmail(`${"a".repeat(245)}@exemplo.com`)).toBeNull();
    expect(normalizeEmail(`${"a".repeat(242)}@exemplo.com`)).not.toBeNull();
  });
});

describe("phone (SF-161)", () => {
  it("accepts 10 or 11 digits with an area code, ignoring punctuation and +55", () => {
    expect(normalizePhone("(91) 98765-4321")).toBe("91987654321");
    expect(normalizePhone("91 3201-7000")).toBe("9132017000");
    expect(normalizePhone("+55 (11) 91234-5678")).toBe("11912345678");
    // "55" without "+" is the area code of Rio Grande do Sul.
    expect(normalizePhone("55 3221-0000")).toBe("5532210000");
  });

  it("refuses other lengths, area codes below 11 and letters", () => {
    for (const text of ["98765-4321", "(91) 98765-43210", "(01) 98765-4321", "(10) 3201-7000", "91 3201-700a", ""]) {
      expect(normalizePhone(text), text).toBeNull();
    }
  });

  it("is shown with the area code and a hyphen", () => {
    expect(formatFormattedValue("PHONE", "91987654321")).toBe("(91) 98765-4321");
    expect(formatFormattedValue("PHONE", "9132017000")).toBe("(91) 3201-7000");
  });
});

describe("CPF and CNPJ (SF-161)", () => {
  it("checks both check digits and refuses repeated digits", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("12345678909")).toBe(true);
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("52998224715")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false);

    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("12345678000195")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("11222333000171")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });

  it("accepts the usual punctuation, stores digits and shows the punctuation again", () => {
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
    expect(normalizeCpf("529 982 247 25")).toBe("52998224725");
    expect(normalizeCpf("529.982.247-2x")).toBeNull();
    expect(formatFormattedValue("CPF", "52998224725")).toBe("529.982.247-25");

    expect(normalizeCnpj("11.222.333/0001-81")).toBe("11222333000181");
    expect(normalizeCnpj("11.222.333/0001-80")).toBeNull();
    expect(formatFormattedValue("CNPJ", "11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("CEP (SF-161)", () => {
  it("accepts 8 digits with or without the hyphen", () => {
    expect(normalizeCep("66075-110")).toBe("66075110");
    expect(normalizeCep("66075110")).toBe("66075110");
    expect(normalizeCep("6607511")).toBeNull();
    expect(normalizeCep("66075-1100")).toBeNull();
    expect(formatFormattedValue("CEP", "66075110")).toBe("66075-110");
  });

  it("leaves a stored value with another shape unchanged on display", () => {
    expect(formatFormattedValue("CEP", "abc")).toBe("abc");
    expect(formatFormattedValue("CPF", "123")).toBe("123");
    expect(formatFormattedValue("EMAIL", "a@b.co")).toBe("a@b.co");
  });
});

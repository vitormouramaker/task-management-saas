import { describe, expect, it } from "vitest";
import {
  formatCnpj,
  formatCpf,
  formatIsoDate,
  formatPhone,
  isValidCnpj,
  isValidCpf,
} from "./documents";

describe("isValidCpf", () => {
  it("aceita CPF com dígitos verificadores corretos", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
  });

  it("recusa dígito verificador errado e sequências repetidas", () => {
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
  });
});

describe("isValidCnpj", () => {
  it("aceita CNPJ numérico válido", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
  });

  it("aceita o CNPJ alfanumérico da Receita Federal", () => {
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
  });

  it("recusa dígito verificador errado e sequências repetidas", () => {
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("00.000.000/0000-00")).toBe(false);
  });
});

describe("máscaras", () => {
  it("formata CPF, CNPJ e celular enquanto digita", () => {
    expect(formatCpf("5299822")).toBe("529.982.2");
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(formatCnpj("12abc34501de35")).toBe("12.ABC.345/01DE-35");
    expect(formatPhone("11987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("1133334444")).toBe("(11) 3333-4444");
  });

  it("converte data ISO para o formato brasileiro", () => {
    expect(formatIsoDate("1990-07-15")).toBe("15/07/1990");
    expect(formatIsoDate(null)).toBe("");
  });
});

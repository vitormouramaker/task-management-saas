const axios = require("axios");

const BRASIL_API_CNPJ_URL = (
  process.env.BRASIL_API_CNPJ_URL || "https://brasilapi.com.br/api/cnpj/v1"
).replace(/\/+$/, "");

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

// Desde jul/2026 a Receita emite CNPJ alfanumérico: 12 posições [A-Z0-9] + 2 dígitos verificadores.
function normalizeCnpj(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function isValidCpf(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  const digits = cpf.split("").map(Number);
  const checkDigit = (length) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += digits[index] * (length + 1 - index);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return checkDigit(9) === digits[9] && checkDigit(10) === digits[10];
}

function isValidCnpj(value) {
  const cnpj = normalizeCnpj(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) {
    return false;
  }

  // Cada caractere vale (código ASCII - 48): dígitos 0-9, letras A=17 ... Z=42.
  const checkDigit = (length) => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += (cnpj.charCodeAt(index) - 48) * weights[index];
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return checkDigit(12) === Number(cnpj[12]) && checkDigit(13) === Number(cnpj[13]);
}

/**
 * Consulta o CNPJ na BrasilAPI (dados da Receita Federal).
 * status: active | inactive | not_found | unavailable
 */
async function lookupCnpj(cnpj) {
  const normalized = normalizeCnpj(cnpj);

  try {
    const { data } = await axios.get(`${BRASIL_API_CNPJ_URL}/${normalized}`, {
      timeout: 8000,
    });
    const registrationStatus =
      String(data?.descricao_situacao_cadastral || "").trim().toUpperCase() || null;

    return {
      status: registrationStatus === "ATIVA" ? "active" : "inactive",
      legalName: data?.razao_social || null,
      tradeName: data?.nome_fantasia || null,
      registrationStatus,
    };
  } catch (error) {
    const httpStatus = error?.response?.status;
    const isNumericCnpj = /^\d{14}$/.test(normalized);

    // 400 com CNPJ alfanumérico pode ser só falta de suporte da API ao formato novo.
    if (httpStatus === 404 || (httpStatus === 400 && isNumericCnpj)) {
      return { status: "not_found", legalName: null, tradeName: null, registrationStatus: null };
    }

    console.warn("[documentos] consulta de CNPJ indisponível", {
      httpStatus: httpStatus || null,
      message: error?.message || String(error),
    });
    return { status: "unavailable", legalName: null, tradeName: null, registrationStatus: null };
  }
}

module.exports = {
  onlyDigits,
  normalizeCnpj,
  isValidCpf,
  isValidCnpj,
  lookupCnpj,
};

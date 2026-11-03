const axios = require("axios");

/**
 * Descobre o código do município no IBGE a partir do CEP.
 *
 * A DPS pede o código do IBGE, mas a Stripe guarda cidade e estado por
 * extenso. O ViaCEP devolve o código pronto, então basta o CEP do endereço de
 * cobrança.
 */
const VIACEP_URL = (process.env.VIACEP_URL || "https://viacep.com.br/ws").replace(/\/+$/, "");

const cache = new Map();

function somenteNumeros(valor) {
  return String(valor || "").replace(/\D/g, "");
}

/**
 * Devolve o código do IBGE, ou `null` quando não dá para descobrir.
 * Nunca estoura: sem o código, quem chama decide o que fazer.
 */
async function codigoIbgePorCep(cep) {
  const limpo = somenteNumeros(cep);
  if (limpo.length !== 8) return null;
  if (cache.has(limpo)) return cache.get(limpo);

  try {
    const { data } = await axios.get(`${VIACEP_URL}/${limpo}/json/`, { timeout: 8000 });
    const codigo = somenteNumeros(data?.ibge);
    const achado = codigo.length === 7 ? codigo : null;
    cache.set(limpo, achado);
    return achado;
  } catch (erro) {
    return null;
  }
}

/**
 * Monta o endereço do tomador no formato que a DPS espera, a partir do
 * endereço que a Stripe guardou. Devolve `null` quando falta o essencial.
 */
async function enderecoParaDps(enderecoStripe) {
  if (!enderecoStripe) return null;
  const cep = somenteNumeros(enderecoStripe.postal_code);
  if (cep.length !== 8) return null;

  const municipio = (await codigoIbgePorCep(cep)) || null;
  if (!municipio) return null;

  const logradouro = String(enderecoStripe.line1 || "").trim();
  const bairro = String(enderecoStripe.line2 || "").trim();
  if (!logradouro) return null;

  // A Stripe junta número e logradouro numa linha só; o layout quer separados.
  const comNumero = /^(.*?)[,\s]+(\d+[A-Za-z]?)$/.exec(logradouro);

  return {
    municipio,
    cep,
    logradouro: comNumero ? comNumero[1].trim() : logradouro,
    numero: comNumero ? comNumero[2] : "S/N",
    bairro: bairro || "CENTRO",
  };
}

module.exports = { codigoIbgePorCep, enderecoParaDps };

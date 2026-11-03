const crypto = require("crypto");
const zlib = require("zlib");
const { promisify } = require("util");

const gzip = promisify(zlib.gzip);

/**
 * Emissão de NFS-e pela API da prefeitura do emitente (layout do padrão
 * nacional da NFS-e).
 *
 * O caminho é: montar a DPS (Declaração de Prestação de Serviço) em XML,
 * assinar com o certificado digital da empresa, compactar, mandar para a
 * prefeitura e guardar a NFS-e que volta.
 *
 * Nada aqui liga sozinho: só funciona com o endereço da API da prefeitura
 * (NFSE_URL_BASE), NFSE_CERT_* e os códigos de tributação configurados. Sem
 * isso, a emissão continua manual pelo portal da prefeitura.
 */

// O endereço da API depende do município (e do fornecedor que ele contratou):
// vem sempre do ambiente, NFSE_URL_BASE.
const AMBIENTES = {
  homologacao: { tpAmb: "2" },
  producao: { tpAmb: "1" },
};

const VERSAO_DPS = "1.01";
const VERSAO_APLIC = "Pauta";
// Código IBGE do município emitente (padrão: São Paulo, só para demonstração).
const CODIGO_MUNICIPIO = String(process.env.NFSE_CODIGO_MUNICIPIO || "3550308").replace(/\D/g, "");

class NfseMunicipalError extends Error {
  constructor(status, message, detalhe = null) {
    super(message);
    this.status = status;
    this.detalhe = detalhe;
  }
}

/**
 * Códigos de tributação por produto vendido.
 *
 * O padrão serve para a assinatura do Pauta, que é licenciamento de software.
 * `NFSE_CODIGOS_POR_PRODUTO` troca isso por produto, num JSON no formato
 * `{"<produto>": {"municipal": "010701001", "nbs": "111032200", "descricao": "..."}}`.
 */
function codigosPorProduto(produto) {
  if (!produto) return null;
  let tabela = {};
  try {
    tabela = JSON.parse(process.env.NFSE_CODIGOS_POR_PRODUTO || "{}");
  } catch (erro) {
    return null;
  }
  const escolhido = tabela[produto] || tabela[String(produto).toLowerCase()];
  return escolhido || null;
}

function configuracao({ produto } = {}) {
  const ambiente = process.env.NFSE_AMBIENTE === "producao" ? "producao" : "homologacao";
  const doProduto = codigosPorProduto(produto) || {};
  const { tpAmb } = AMBIENTES[ambiente];

  return {
    ambiente,
    tpAmb,
    baseUrl: String(process.env.NFSE_URL_BASE || "").replace(/\/+$/, ""),
    cnpj: somenteNumeros(process.env.NFSE_CNPJ),
    inscricaoMunicipal: somenteNumeros(process.env.NFSE_INSCRICAO_MUNICIPAL),
    razaoSocial: process.env.NFSE_RAZAO_SOCIAL || "",
    // A prefeitura reserva as séries 00001 a 10000 para o sistema dela: quem
    // emite por fora usa de 10001 a 49999 (erro L0022).
    serie: String(process.env.NFSE_SERIE || "10001").padStart(5, "0"),
    // Quando o produto traz o código de 9 dígitos, ele manda sozinho: herdar o
    // código nacional do ambiente faria a nota sair com a atividade errada.
    ...separarCodigosDeTributacao(
      doProduto.nacional || (doProduto.municipal ? "" : process.env.NFSE_CODIGO_TRIB_NACIONAL),
      doProduto.municipal || process.env.NFSE_CODIGO_TRIB_MUN,
    ),
    // Simples Nacional: 1 = não optante, 2 = optante MEI, 3 = optante ME/EPP.
    opcaoSimplesNacional: String(process.env.NFSE_SIMPLES_NACIONAL || "3"),
    // Só vale para o optante ME/EPP: 1 = tudo apurado pelo Simples, 2 = ISSQN
    // por fora, 3 = ISSQN e os federais por fora.
    regimeApuracaoSimples: process.env.NFSE_REGIME_APURACAO_SN || "1",
    regimeEspecial: String(process.env.NFSE_REGIME_ESPECIAL || "0"),
    // 1 = exigível, 2 = não incidência, 3 = isenção, 4 = exportação.
    tribIssqn: String(process.env.NFSE_TRIB_ISSQN || "1"),
    aliquota: process.env.NFSE_ALIQUOTA || "",
    // Código da Nomenclatura Brasileira de Serviços, 9 dígitos.
    codigoNbs: somenteNumeros(doProduto.nbs || process.env.NFSE_CODIGO_NBS),
    certificadoBase64: process.env.NFSE_CERT_PFX_BASE64 || "",
    certificadoSenha: process.env.NFSE_CERT_SENHA || "",
    descricaoPadrao:
      doProduto.descricao ||
      process.env.NFSE_DESCRICAO_SERVICO ||
      "Assinatura mensal da plataforma Pauta (software como serviço).",
  };
}

/**
 * A tabela da prefeitura publica o código da atividade com 9 dígitos, que é a
 * junção do código nacional (6) com o municipal (3) -- por exemplo,
 * 010401003 = nacional 010401 + municipal 003. O layout pede os dois
 * separados, então aceitamos o código inteiro em qualquer uma das variáveis.
 */
function separarCodigosDeTributacao(nacional, municipal) {
  const completo = somenteNumeros(municipal).length === 9 ? somenteNumeros(municipal) : "";
  const nacionalLimpo = somenteNumeros(nacional);

  if (completo) {
    return {
      codigoTributacaoNacional: nacionalLimpo || completo.slice(0, 6),
      codigoTributacaoMunicipal: completo.slice(6),
    };
  }

  if (nacionalLimpo.length === 9) {
    return {
      codigoTributacaoNacional: nacionalLimpo.slice(0, 6),
      codigoTributacaoMunicipal: somenteNumeros(municipal) || nacionalLimpo.slice(6),
    };
  }

  return {
    codigoTributacaoNacional: nacionalLimpo,
    codigoTributacaoMunicipal: somenteNumeros(municipal),
  };
}

/** Diz se dá para emitir sozinho ou se a emissão segue manual. */
function emissaoAutomaticaLigada() {
  const config = configuracao();
  return Boolean(
    config.baseUrl &&
      config.cnpj &&
      config.inscricaoMunicipal &&
      config.codigoTributacaoNacional &&
      config.certificadoBase64 &&
      config.certificadoSenha,
  );
}

function somenteNumeros(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function escapar(texto) {
  return String(texto === null || texto === undefined ? "" : texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tag(nome, valor) {
  if (valor === null || valor === undefined || valor === "") return "";
  return `<${nome}>${escapar(valor)}</${nome}>`;
}

function dinheiro(centavos) {
  return (Number(centavos || 0) / 100).toFixed(2);
}

/** Data/hora no formato que o layout pede (ISO com fuso). */
function dataHoraComFuso(data = new Date()) {
  // Horário de Brasília, sem horário de verão: é sempre UTC-3. Tira as 3 horas
  // antes de escrever, senão o horário sai adiantado com o rótulo errado.
  const emBrasilia = new Date(data.getTime() - 3 * 60 * 60 * 1000);
  return emBrasilia.toISOString().replace(/\.\d{3}Z$/, "-03:00");
}

/**
 * Identificador da DPS, montado como manda o layout nacional:
 * "DPS" + município (7) + tipo de inscrição (1) + inscrição (14) + série (5) + número (15).
 */
function montarIdDps({ municipio, cnpj, serie, numero }) {
  return [
    "DPS",
    String(municipio).padStart(7, "0"),
    "2", // 2 = CNPJ
    somenteNumeros(cnpj).padStart(14, "0"),
    String(serie).padStart(5, "0"),
    String(numero).padStart(15, "0"),
  ].join("");
}

/**
 * Monta o XML da DPS. `tomador` aceita CNPJ ou CPF; sem documento, a nota sai
 * para consumidor não identificado, o que a prefeitura permite.
 */
function montarDps({ numero, competencia, tomador, valorCentavos, descricao, config = configuracao() }) {
  if (!config.cnpj) throw new NfseMunicipalError(400, "Falta o CNPJ do emitente (NFSE_CNPJ).");
  if (!numero) throw new NfseMunicipalError(400, "Falta o número da DPS.");
  if (!valorCentavos || valorCentavos <= 0) throw new NfseMunicipalError(400, "Valor do serviço inválido.");

  const idDps = montarIdDps({
    municipio: CODIGO_MUNICIPIO,
    cnpj: config.cnpj,
    serie: config.serie,
    numero,
  });

  const documentoTomador = somenteNumeros(tomador?.documento);
  const tipoDocumento = documentoTomador.length === 14 ? "CNPJ" : documentoTomador.length === 11 ? "CPF" : null;

  if (tipoDocumento && !tomador?.nome) {
    throw new NfseMunicipalError(400, "Falta o nome ou a razão social do tomador.");
  }

  // O endereço do tomador é exigido em boa parte das atividades: sem ele a
  // prefeitura recusa com "Estado deve ser informado".
  const endereco = tomador?.endereco;
  const blocoEndereco = endereco?.municipio
    ? [
        "<end>",
        "<endNac>",
        tag("cMun", somenteNumeros(endereco.municipio)),
        tag("CEP", somenteNumeros(endereco.cep)),
        "</endNac>",
        tag("xLgr", endereco.logradouro),
        tag("nro", endereco.numero || "S/N"),
        endereco.complemento ? tag("xCpl", endereco.complemento) : "",
        tag("xBairro", endereco.bairro),
        "</end>",
      ].join("")
    : "";

  const blocoTomador = tipoDocumento
    ? [
        "<toma>",
        tag(tipoDocumento, documentoTomador),
        tag("IM", somenteNumeros(tomador?.inscricaoMunicipal) || null),
        tag("xNome", tomador?.nome),
        blocoEndereco,
        tomador?.email ? tag("email", tomador.email) : "",
        "</toma>",
      ].join("")
    : "";

  const corpo = [
    `<infDPS Id="${idDps}">`,
    tag("tpAmb", config.tpAmb),
    tag("dhEmi", dataHoraComFuso()),
    tag("verAplic", VERSAO_APLIC),
    tag("serie", config.serie),
    tag("nDPS", String(numero)),
    tag("dCompet", competencia),
    tag("tpEmit", "1"), // 1 = emitido pelo prestador
    tag("cLocEmi", CODIGO_MUNICIPIO),
    "<prest>",
    tag("CNPJ", config.cnpj),
    tag("IM", config.inscricaoMunicipal),
    tag("xNome", config.razaoSocial || null),
    "<regTrib>",
    tag("opSimpNac", config.opcaoSimplesNacional),
    config.opcaoSimplesNacional === "3" && config.regimeApuracaoSimples
      ? tag("regApTribSN", config.regimeApuracaoSimples)
      : "",
    tag("regEspTrib", config.regimeEspecial),
    "</regTrib>",
    "</prest>",
    blocoTomador,
    "<serv>",
    "<locPrest>",
    tag("cLocPrestacao", CODIGO_MUNICIPIO),
    "</locPrest>",
    "<cServ>",
    tag("cTribNac", config.codigoTributacaoNacional),
    config.codigoTributacaoMunicipal ? tag("cTribMun", config.codigoTributacaoMunicipal) : "",
    tag("xDescServ", descricao || config.descricaoPadrao),
    config.codigoNbs ? tag("cNBS", config.codigoNbs) : "",
    "</cServ>",
    "</serv>",
    "<valores>",
    "<vServPrest>",
    tag("vServ", dinheiro(valorCentavos)),
    "</vServPrest>",
    "<trib>",
    "<tribMun>",
    tag("tribISSQN", config.tribIssqn),
    tag("tpRetISSQN", "1"), // 1 = não retido
    config.aliquota ? tag("pAliq", config.aliquota) : "",
    "</tribMun>",
    // Totais aproximados de tributos (Lei 12.741/2012): o layout exige o
    // grupo; no Simples Nacional informamos o indicador de "não informado".
    "<totTrib>",
    tag("indTotTrib", "0"),
    "</totTrib>",
    "</trib>",
    "</valores>",
    "</infDPS>",
  ].join("");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="${VERSAO_DPS}">${corpo}</DPS>`;

  return { xml, idDps };
}

/** Abre o certificado A1 (.pfx) e devolve chave e certificado em PEM. */
function abrirCertificado(config = configuracao()) {
  if (!config.certificadoBase64 || !config.certificadoSenha) {
    throw new NfseMunicipalError(400, "Certificado digital não configurado (NFSE_CERT_PFX_BASE64/NFSE_CERT_SENHA).");
  }

  const forge = require("node-forge");
  const binario = forge.util.decode64(config.certificadoBase64);

  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(binario), config.certificadoSenha);
  } catch (erro) {
    throw new NfseMunicipalError(400, "Não foi possível abrir o certificado: arquivo ou senha inválidos.");
  }

  const chaves = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
    forge.pki.oids.pkcs8ShroudedKeyBag
  ];
  const certificados = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];

  if (!chaves?.length || !certificados?.length) {
    throw new NfseMunicipalError(400, "O certificado não tem chave privada utilizável.");
  }

  const certificado = certificados[0].cert;
  const validade = certificado.validity?.notAfter;
  if (validade && validade.getTime() < Date.now()) {
    throw new NfseMunicipalError(400, `O certificado digital venceu em ${validade.toLocaleDateString("pt-BR")}.`);
  }

  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(chaves[0].key),
    certificadoPem: forge.pki.certificateToPem(certificado),
    titular: certificado.subject?.getField("CN")?.value || null,
    validade: validade || null,
  };
}

/**
 * Assina a DPS no padrão XMLDSig.
 *
 * O autorizador nacional usa RSA-SHA1, o mesmo da NF-e: com SHA-256 ele
 * devolve "E0714 Arquivo enviado com erro na assinatura", mesmo com a
 * assinatura correta. `NFSE_ASSINATURA_SHA256=1` volta para SHA-256, caso um
 * dia o padrão mude.
 */
function assinarDps(xml, idDps, config = configuracao()) {
  return assinarXml(xml, idDps, "infDPS", config);
}

/** Assina qualquer documento do layout, apontando para o elemento que leva o Id. */
function assinarXml(xml, id, elemento, config = configuracao()) {
  const { SignedXml } = require("xml-crypto");
  const { chavePrivadaPem, certificadoPem } = abrirCertificado(config);
  const comSha256 = process.env.NFSE_ASSINATURA_SHA256 === "1";

  const assinador = new SignedXml({
    privateKey: chavePrivadaPem,
    publicCert: certificadoPem,
    signatureAlgorithm: comSha256
      ? "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"
      : "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });

  assinador.addReference({
    xpath: `//*[local-name(.)='${elemento}']`,
    uri: `#${id}`,
    digestAlgorithm: comSha256
      ? "http://www.w3.org/2001/04/xmlenc#sha256"
      : "http://www.w3.org/2000/09/xmldsig#sha1",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
  });

  assinador.computeSignature(xml, {
    location: { reference: `//*[local-name(.)='${elemento}']`, action: "after" },
  });

  return assinador.getSignedXml();
}

/** A prefeitura recebe o XML compactado e em base64. */
async function compactar(xml) {
  const comprimido = await gzip(Buffer.from(xml, "utf8"));
  return comprimido.toString("base64");
}

async function chamarApi(caminho, { metodo = "GET", corpo = null, config = configuracao() } = {}) {
  const endereco = `${config.baseUrl}${caminho}`;
  const resposta = await fetch(endereco, {
    method: metodo,
    headers: {
      Accept: "application/json",
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = texto;
  }

  if (!resposta.ok) {
    const mensagem =
      (dados && (dados.mensagem || dados.message || dados.erro)) ||
      `A prefeitura respondeu ${resposta.status}.`;
    throw new NfseMunicipalError(resposta.status, mensagem, dados);
  }

  return dados;
}

/** Monta, assina, compacta e envia a DPS. Devolve o que a prefeitura respondeu. */
async function emitir({ numero, competencia, tomador, valorCentavos, descricao, produto }) {
  const config = configuracao({ produto });
  if (!emissaoAutomaticaLigada()) {
    throw new NfseMunicipalError(
      409,
      "Emissão automática não configurada: a nota segue sendo emitida pelo portal da prefeitura.",
    );
  }

  const { xml, idDps } = montarDps({ numero, competencia, tomador, valorCentavos, descricao, config });
  const assinado = assinarDps(xml, idDps, config);
  const dpsXmlGZipB64 = await compactar(assinado);

  const resposta = await chamarApi("/notafiscal-ws/nfse", {
    metodo: "POST",
    corpo: { dpsXmlGZipB64 },
    config,
  });

  return {
    idDps,
    ambiente: config.ambiente,
    chaveAcesso: resposta?.chaveAcesso || resposta?.chave || null,
    numeroNfse: resposta?.nfseNumero || resposta?.numero || null,
    resposta,
  };
}

async function consultarPorChave(chaveAcesso) {
  return chamarApi(`/notafiscal-ws/nfse/${encodeURIComponent(chaveAcesso)}`);
}

async function consultarChavePorDps(idDps) {
  return chamarApi(`/notafiscal-ws/nfse/dps/${encodeURIComponent(idDps)}`);
}

/** Cancelamento e demais eventos usam o mesmo caminho de envio. */
/**
 * Identificador do pedido de registro de evento, como manda o layout:
 * "PRE" + chave de acesso (50) + tipo do evento (6).
 */
function montarIdPedidoEvento(chaveAcesso, tipoEvento) {
  return `PRE${somenteNumeros(chaveAcesso)}${tipoEvento}`;
}

/**
 * Monta o pedido de cancelamento da nota (evento e101101).
 *
 * `codigoMotivo`: 1 = erro na emissão, 2 = serviço não prestado, 9 = outros.
 * `motivo` é texto livre, e o layout exige de 15 a 255 caracteres.
 */
function montarCancelamento(chaveAcesso, { codigoMotivo = "1", motivo, config = configuracao() } = {}) {
  const chave = somenteNumeros(chaveAcesso);
  if (chave.length !== 50) {
    throw new NfseMunicipalError(400, "Chave de acesso da NFS-e inválida.");
  }
  const texto = String(motivo || "").trim();
  if (texto.length < 15 || texto.length > 255) {
    throw new NfseMunicipalError(400, "O motivo do cancelamento precisa ter de 15 a 255 caracteres.");
  }
  if (!["1", "2", "9"].includes(String(codigoMotivo))) {
    throw new NfseMunicipalError(400, "Código de motivo inválido: use 1, 2 ou 9.");
  }

  const idPedido = montarIdPedidoEvento(chave, "101101");
  const corpo = [
    `<infPedReg Id="${idPedido}">`,
    tag("tpAmb", config.tpAmb),
    tag("verAplic", VERSAO_APLIC),
    tag("dhEvento", dataHoraComFuso()),
    tag("CNPJAutor", config.cnpj),
    tag("chNFSe", chave),
    "<e101101>",
    tag("xDesc", "Cancelamento de NFS-e"),
    tag("cMotivo", String(codigoMotivo)),
    tag("xMotivo", texto),
    "</e101101>",
    "</infPedReg>",
  ].join("");

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<pedRegEvento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">${corpo}</pedRegEvento>`;

  return { xml, idPedido };
}

/** Cancela a nota na prefeitura. Devolve o que o autorizador respondeu. */
async function cancelar(chaveAcesso, { codigoMotivo = "1", motivo } = {}) {
  const config = configuracao();
  if (!emissaoAutomaticaLigada()) {
    throw new NfseMunicipalError(409, "Cancelamento automático não configurado.");
  }
  const { xml, idPedido } = montarCancelamento(chaveAcesso, { codigoMotivo, motivo, config });
  const assinado = assinarXml(xml, idPedido, "infPedReg", config);
  const resposta = await enviarEvento(chaveAcesso, assinado);
  return { idPedido, resposta };
}

async function enviarEvento(chaveAcesso, xmlEvento) {
  const config = configuracao();
  const pedidoXmlGZipB64 = await compactar(xmlEvento);
  return chamarApi(`/notafiscal-ws/nfse/${encodeURIComponent(chaveAcesso)}/eventos`, {
    metodo: "POST",
    corpo: { pedidoRegistroEventoXmlGZipB64: pedidoXmlGZipB64 },
    config,
  });
}

/** Resumo do que está configurado, para a tela do painel. */
function situacao() {
  const config = configuracao();
  const faltando = [];
  if (!config.baseUrl) faltando.push("endereço da API da prefeitura (NFSE_URL_BASE)");
  if (!config.cnpj) faltando.push("CNPJ do emitente");
  if (!config.inscricaoMunicipal) faltando.push("inscrição municipal");
  if (!config.codigoTributacaoNacional) faltando.push("código de tributação nacional");
  if (!config.certificadoBase64 || !config.certificadoSenha) faltando.push("certificado digital A1");

  let certificado = null;
  if (config.certificadoBase64 && config.certificadoSenha) {
    try {
      const aberto = abrirCertificado(config);
      certificado = { titular: aberto.titular, validade: aberto.validade };
    } catch (erro) {
      faltando.push(erro.message);
    }
  }

  return {
    ambiente: config.ambiente,
    automatica: emissaoAutomaticaLigada() && faltando.length === 0,
    faltando,
    certificado,
    serie: config.serie,
  };
}

module.exports = {
  CODIGO_MUNICIPIO,
  codigosPorProduto,
  cancelar,
  montarCancelamento,
  montarIdPedidoEvento,
  assinarXml,
  NfseMunicipalError,
  abrirCertificado,
  assinarDps,
  compactar,
  configuracao,
  consultarChavePorDps,
  consultarPorChave,
  emissaoAutomaticaLigada,
  emitir,
  enviarEvento,
  montarDps,
  montarIdDps,
  situacao,
};

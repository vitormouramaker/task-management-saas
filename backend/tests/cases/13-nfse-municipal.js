/**
 * Emissão de NFS-e pela API da prefeitura: montagem da DPS,
 * assinatura digital, envio compactado e consulta da nota.
 *
 * Roda contra a prefeitura falsa da suíte, com um certificado A1 gerado na
 * hora. Nada sai para a prefeitura de verdade.
 */
const { SignedXml } = require("xml-crypto");
const { gerarCertificadoDeTeste } = require("../lib/certificado");

function textoDaTag(xml, nome) {
  const achado = xml.match(new RegExp(`<${nome}>([^<]*)</${nome}>`));
  return achado ? achado[1] : null;
}

module.exports = async function casosDeNfseMunicipal(ctx) {
  const { check, constants, db } = ctx;

  // O serviço lê a configuração a cada chamada, então basta preparar o
  // ambiente aqui: prefeitura falsa + certificado gerado para o teste.
  const certificado = gerarCertificadoDeTeste();
  process.env.NFSE_AMBIENTE = "homologacao";
  process.env.NFSE_URL_BASE = `http://127.0.0.1:${constants.appPort + 1}`;
  process.env.NFSE_CNPJ = "12345678000199";
  process.env.NFSE_INSCRICAO_MUNICIPAL = "1234567";
  process.env.NFSE_RAZAO_SOCIAL = "EMPRESA DE TESTES LTDA";
  process.env.NFSE_SERIE = "1";
  process.env.NFSE_CODIGO_TRIB_NACIONAL = "010701";
  process.env.NFSE_SIMPLES_NACIONAL = "2";
  process.env.NFSE_CERT_PFX_BASE64 = certificado.base64;
  process.env.NFSE_CERT_SENHA = certificado.senha;

  const nfse = require("../../src/services/nfse-municipal.service");

  // ---------- configuração ----------
  let situacao = nfse.situacao();
  check(
    "a configuração reconhece que dá para emitir sozinho",
    situacao.automatica === true && situacao.ambiente === "homologacao",
    JSON.stringify(situacao),
  );
  check(
    "o certificado é aberto e o titular aparece",
    String(situacao.certificado?.titular || "").includes("PAUTA TESTE"),
    JSON.stringify(situacao.certificado),
  );

  // A tabela da prefeitura publica o código com 9 dígitos (nacional + municipal).
  process.env.NFSE_CODIGO_TRIB_MUN = "010401003";
  delete process.env.NFSE_CODIGO_TRIB_NACIONAL;
  const codigos = nfse.configuracao();
  check(
    "o código de 9 dígitos da tabela vira código nacional e municipal",
    codigos.codigoTributacaoNacional === "010401" && codigos.codigoTributacaoMunicipal === "003",
    JSON.stringify({ nacional: codigos.codigoTributacaoNacional, municipal: codigos.codigoTributacaoMunicipal }),
  );
  process.env.NFSE_CODIGO_TRIB_NACIONAL = "010701";
  delete process.env.NFSE_CODIGO_TRIB_MUN;

  // ---------- montagem da DPS ----------
  const { xml, idDps } = nfse.montarDps({
    numero: 1,
    competencia: "2026-10-01",
    tomador: {
      documento: "12345678000199",
      nome: "Cliente de Teste LTDA",
      email: "cliente@test.com",
      endereco: {
        municipio: "3550308",
        cep: "01001000",
        logradouro: "UNIVERSITARIA",
        numero: "750",
        bairro: "FATIMA",
      },
    },
    valorCentavos: 12900,
    descricao: "Assinatura mensal do Pauta — plano Profissional.",
  });

  let recusouSemNome = false;
  try {
    nfse.montarDps({
      numero: 2,
      competencia: "2026-10-01",
      tomador: { documento: "12345678000199" },
      valorCentavos: 12900,
    });
  } catch (erro) {
    recusouSemNome = /nome ou a razão social/i.test(erro.message);
  }
  check(
    "tomador sem nome é recusado, porque o layout exige xNome",
    recusouSemNome,
  );

  check(
    "a DPS sai no formato do layout nacional",
    idDps.length === 45 &&
      idDps.startsWith("DPS3550308") &&
      xml.includes('xmlns="http://www.sped.fazenda.gov.br/nfse"') &&
      xml.includes('versao="1.01"'),
    `${idDps} (${idDps.length} caracteres)`,
  );

  check(
    "a DPS leva prestador, tomador, serviço e valor",
    textoDaTag(xml, "CNPJ") === "12345678000199" &&
      /<toma>.*?<CNPJ>12345678000199<\/CNPJ>/.test(xml) &&
      textoDaTag(xml, "vServ") === "129.00" &&
      textoDaTag(xml, "cTribNac") === "010701" &&
      textoDaTag(xml, "tpAmb") === "2",
    xml.slice(0, 200),
  );

  check(
    "a DPS traz o total aproximado de tributos, como o layout exige",
    xml.includes("<totTrib><indTotTrib>0</indTotTrib></totTrib>"),
    xml.slice(-300),
  );

  check(
    "o endereço do tomador vai na DPS, que a prefeitura exige",
    xml.includes("<end><endNac><cMun>3550308</cMun><CEP>01001000</CEP></endNac>") &&
      xml.includes("<xBairro>FATIMA</xBairro>"),
  );

  // ---------- assinatura ----------
  const assinado = nfse.assinarDps(xml, idDps);
  const assinaturaXml = (assinado.match(/<(?:\w+:)?Signature[\s\S]*<\/(?:\w+:)?Signature>/) || [])[0];
  const verificador = new SignedXml({ publicCert: nfse.abrirCertificado().certificadoPem });
  if (assinaturaXml) verificador.loadSignature(assinaturaXml);

  check(
    "a DPS é assinada e a assinatura confere com o certificado",
    Boolean(assinaturaXml) && verificador.checkSignature(assinado) === true,
    JSON.stringify(verificador.validationErrors || []),
  );

  check(
    "a assinatura usa RSA-SHA1, que é o que o autorizador nacional aceita",
    assinado.includes('Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"') &&
      assinado.includes('Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"'),
    "com SHA-256 a prefeitura responde E0714",
  );

  // ---------- cancelamento ----------
  const chaveFalsa = "2".repeat(50);
  const cancelamento = nfse.montarCancelamento(chaveFalsa, {
    codigoMotivo: "1",
    motivo: "Nota emitida por engano no teste de integracao.",
  });
  const cancelamentoAssinado = nfse.assinarXml(
    cancelamento.xml,
    cancelamento.idPedido,
    "infPedReg",
  );
  const assinaturaCancelamento = (
    cancelamentoAssinado.match(/<(?:\w+:)?Signature[\s\S]*<\/(?:\w+:)?Signature>/) || []
  )[0];
  const verificadorCancelamento = new SignedXml({
    publicCert: nfse.abrirCertificado().certificadoPem,
  });
  if (assinaturaCancelamento) verificadorCancelamento.loadSignature(assinaturaCancelamento);

  check(
    "o pedido de cancelamento sai no formato do layout e assinado",
    cancelamento.idPedido.length === 59 &&
      cancelamento.idPedido.startsWith("PRE") &&
      cancelamento.xml.includes("<xDesc>Cancelamento de NFS-e</xDesc>") &&
      Boolean(assinaturaCancelamento) &&
      verificadorCancelamento.checkSignature(cancelamentoAssinado) === true,
    cancelamento.idPedido,
  );

  let recusouMotivoCurto = false;
  try {
    nfse.montarCancelamento(chaveFalsa, { motivo: "errei" });
  } catch (erro) {
    recusouMotivoCurto = /15 a 255/.test(erro.message);
  }
  check("motivo curto demais e recusado antes de sair daqui", recusouMotivoCurto);

  const comprimido = await nfse.compactar(assinado);
  const voltou = require("zlib").gunzipSync(Buffer.from(comprimido, "base64")).toString("utf8");
  check(
    "o envio vai compactado e volta igual ao que foi assinado",
    voltou === assinado && comprimido.length < assinado.length,
    `${comprimido.length} bytes em base64 contra ${assinado.length} do XML`,
  );

  // ---------- envio e consultas ----------
  const emissao = await nfse.emitir({
    numero: 1,
    competencia: "2026-10-01",
    tomador: { documento: "12345678000199", nome: "Cliente de Teste LTDA" },
    valorCentavos: 12900,
  });
  check(
    "a prefeitura recebe a DPS e devolve a nota",
    String(emissao.chaveAcesso || "").length > 10 && emissao.numeroNfse === "1",
    JSON.stringify({ chave: emissao.chaveAcesso, numero: emissao.numeroNfse }),
  );

  const consulta = await nfse.consultarPorChave(emissao.chaveAcesso);
  check(
    "dá para consultar a nota pela chave de acesso",
    consulta?.chaveAcesso === emissao.chaveAcesso,
    JSON.stringify(consulta?.chaveAcesso),
  );

  const porDps = await nfse.consultarChavePorDps(emissao.idDps);
  check(
    "dá para achar a nota a partir do identificador da DPS",
    porDps?.chaveAcesso === emissao.chaveAcesso,
    JSON.stringify(porDps),
  );

  // ---------- recusas ----------
  let recusouSemValor = false;
  try {
    nfse.montarDps({ numero: 2, competencia: "2026-10-01", valorCentavos: 0 });
  } catch (erro) {
    recusouSemValor = erro.status === 400;
  }
  check("nota sem valor é recusada antes de sair daqui", recusouSemValor, "");

  let recusouSenhaErrada = false;
  process.env.NFSE_CERT_SENHA = "senha-errada";
  try {
    nfse.abrirCertificado();
  } catch (erro) {
    recusouSenhaErrada = erro.status === 400 && erro.message.includes("senha inválidos");
  }
  process.env.NFSE_CERT_SENHA = certificado.senha;
  check("certificado com senha errada é recusado com mensagem clara", recusouSenhaErrada, "");

  delete process.env.NFSE_CERT_PFX_BASE64;
  delete process.env.NFSE_CERT_SENHA;
  situacao = nfse.situacao();
  check(
    "sem certificado, a emissão automática fica desligada e diz o que falta",
    situacao.automatica === false && situacao.faltando.some((item) => item.includes("certificado")),
    JSON.stringify(situacao.faltando),
  );

  let recusouEmitir = false;
  try {
    await nfse.emitir({ numero: 3, competencia: "2026-10-01", valorCentavos: 1000 });
  } catch (erro) {
    recusouEmitir = erro.status === 409;
  }
  check("sem configuração, emitir avisa que a nota segue manual", recusouEmitir, "");

  // ---------- emissão automática a partir de uma fatura paga ----------
  // Os testes acima apagam a configuração de propósito; aqui ela volta.
  process.env.NFSE_AMBIENTE = "homologacao";
  process.env.NFSE_URL_BASE = `http://127.0.0.1:${constants.appPort + 1}`;
  process.env.NFSE_CNPJ = "12345678000199";
  process.env.NFSE_INSCRICAO_MUNICIPAL = "1234567";
  process.env.NFSE_RAZAO_SOCIAL = "EMPRESA DE TESTES LTDA";
  process.env.NFSE_SERIE = "10001";
  process.env.NFSE_CODIGO_TRIB_NACIONAL = "010701";
  process.env.NFSE_CODIGO_NBS = "111032200";
  process.env.NFSE_CERT_PFX_BASE64 = certificado.base64;
  process.env.NFSE_CERT_SENHA = certificado.senha;
  process.env.VIACEP_URL = `http://127.0.0.1:${constants.appPort + 1}`;
  process.env.NFSE_CODIGOS_POR_PRODUTO = JSON.stringify({
    plano_aula: { municipal: "010401003", nbs: "111032100", descricao: "Aula avulsa." },
  });

  const notas = require("../../src/services/nfse.service");
  await notas.ensureNfseSchema(db);

  const corrida = Date.now().toString(36);
  function faturaFalsa(sufixo, { endereco = true } = {}) {
    return {
      id: `in_teste_${corrida}_${sufixo}`,
      customer: `cus_teste_${corrida}_${sufixo}`,
      amount_paid: 9700,
      created: Math.floor(Date.now() / 1000),
      customer_name: "CLIENTE DE TESTE LTDA",
      customer_email: "cliente@test.com",
      customer_tax_ids: [{ value: "12345678000199" }],
      customer_address: endereco
        ? { line1: "RUA DE TESTE, 750", line2: "CENTRO", postal_code: "01001000", city: "São Paulo", state: "SP" }
        : null,
      lines: { data: [{ amount: 9700, description: "Plano Profissional", metadata: { planId: "profissional" } }] },
    };
  }

  const comEndereco = await notas.recordPaidInvoice(faturaFalsa("a"), db);
  check(
    "fatura paga vira nota emitida sozinha",
    comEndereco.recorded === true && comEndereco.emissao?.emitida === true,
    JSON.stringify(comEndereco.emissao),
  );

  const salvo = await db.query(
    "SELECT status, access_key, dps_number, dps_series, document_url, last_error FROM nfse_records WHERE stripe_invoice_id = $1",
    [`in_teste_${corrida}_a`],
  );
  check(
    "o pedido guarda a chave de acesso, o número da DPS e o link",
    salvo.rows[0]?.status === "emitida" &&
      Boolean(salvo.rows[0]?.access_key) &&
      Number(salvo.rows[0]?.dps_number) > 0 &&
      Boolean(salvo.rows[0]?.document_url) &&
      salvo.rows[0]?.last_error === null,
    JSON.stringify(salvo.rows[0]),
  );

  const semEndereco = await notas.recordPaidInvoice(faturaFalsa("b", { endereco: false }), db);
  const pendente = await db.query(
    "SELECT status, last_error, auto_attempts FROM nfse_records WHERE stripe_invoice_id = $1",
    [`in_teste_${corrida}_b`],
  );
  check(
    "sem endereço do cliente a nota fica pendente, com o motivo anotado",
    semEndereco.recorded === true &&
      pendente.rows[0]?.status === "pendente" &&
      /endereço/i.test(pendente.rows[0]?.last_error || "") &&
      pendente.rows[0]?.auto_attempts === 1,
    JSON.stringify(pendente.rows[0]),
  );

  check(
    "o produto escolhe o código do serviço",
    nfse.configuracao({ produto: "plano_aula" }).codigoTributacaoNacional === "010401" &&
      nfse.configuracao({ produto: "plano_aula" }).codigoNbs === "111032100" &&
      nfse.configuracao({}).codigoTributacaoNacional === "010701",
    JSON.stringify({
      aula: nfse.configuracao({ produto: "plano_aula" }).codigoTributacaoNacional,
      padrao: nfse.configuracao({}).codigoTributacaoNacional,
    }),
  );

  delete process.env.NFSE_CODIGOS_POR_PRODUTO;
};

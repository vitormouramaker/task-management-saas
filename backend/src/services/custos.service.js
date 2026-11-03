const { postgres } = require("../server/connect");

/**
 * Quanto a Bunny está custando, e quem está consumindo.
 *
 * A Bunny cobra por armazenamento e por tráfego. Sem acompanhar, a conta só
 * aparece no fim do mês — e já aconteceu. Aqui o Pauta soma o uso por conta,
 * estima o custo e avisa quando passa dos limites combinados.
 *
 * O armazenamento sai do próprio banco (`storage_files`), que é a fonte certa:
 * é o que o Pauta colocou lá. O tráfego vem da API da Bunny quando houver
 * `BUNNY_API_KEY`; sem ela, o relatório sai só com o armazenamento e diz isso.
 */
const GB = 1024 * 1024 * 1024;

// Conta nesses estados não paga, mas o arquivo dela continua ocupando espaço.
const SITUACOES_SEM_ASSINATURA = ["canceled", "unpaid", "incomplete_expired", "past_due"];

// Preços da Bunny, em reais. Mudam com o câmbio e com o plano, então ficam
// configuráveis: o padrão segue a tabela de armazenamento + CDN padrão.
/** Lê número do ambiente aceitando zero, que `|| padrão` descartaria. */
function numeroDoAmbiente(nome, padrao) {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === null || String(bruto).trim() === "") return padrao;
  const valor = Number(bruto);
  return Number.isFinite(valor) ? valor : padrao;
}

// A Bunny cobra em dólar. Os padrões saem da fatura real da conta: o tráfego
// sai a US$ 0,01/GB e o armazenamento é o que pesa (quase toda a conta do mês).
const PRECO_ARMAZENAMENTO_GB = numeroDoAmbiente("BUNNY_PRECO_ARMAZENAMENTO_GB", 0.01);
const PRECO_TRAFEGO_GB = numeroDoAmbiente("BUNNY_PRECO_TRAFEGO_GB", 0.01);
// Só para mostrar o valor em reais ao lado; o que vale é o dólar da fatura.
const CAMBIO = numeroDoAmbiente("BUNNY_CAMBIO_USD", 5.4);

// Avisa quando a conta passa desta fatia do que o plano dá.
const FATIA_DE_AVISO = numeroDoAmbiente("CUSTOS_AVISO_PERCENTUAL", 0.9);
// Avisa quando o custo do mês passa deste teto, em reais.
// Teto em dólar: a conta tem fechado perto de US$ 42, então US$ 60 é folga
// suficiente para avisar antes de virar surpresa.
const TETO_MENSAL = numeroDoAmbiente("CUSTOS_TETO_MENSAL", 60);

let schemaPronto = null;

function garantirSchema(db = postgres) {
  if (!schemaPronto) {
    schemaPronto = db
      .query(
        `
          CREATE TABLE IF NOT EXISTS custos_avisos (
            id BIGSERIAL PRIMARY KEY,
            tipo VARCHAR(40) NOT NULL,
            referencia VARCHAR(120) NOT NULL,
            dia DATE NOT NULL DEFAULT CURRENT_DATE,
            detalhe JSONB,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tipo, referencia, dia)
          )
        `,
      )
      .catch((erro) => {
        schemaPronto = null;
        throw erro;
      });
  }
  return schemaPronto;
}

/** Quanto cada conta tem guardado, e quanto o plano dela permite. */
async function usoPorConta(db = postgres) {
  const { rows } = await db.query(`
    SELECT o.id,
           o.name AS nome,
           o.plan AS plano,
           o.subscription_status AS situacao,
           o.billing_exempt AS isenta,
           COALESCE(SUM(f.size_bytes) FILTER (WHERE f.deleted_at IS NULL), 0)::bigint AS bytes,
           COUNT(f.id) FILTER (WHERE f.deleted_at IS NULL) AS arquivos
    FROM organizations o
    LEFT JOIN storage_files f ON f.organization_id = o.id
    GROUP BY o.id, o.name, o.plan, o.subscription_status, o.billing_exempt
    ORDER BY 6 DESC
  `);

  const { buildPlanEntitlements } = require("./billing.service");
  return rows.map((linha) => {
    const bytes = Number(linha.bytes || 0);
    let limiteMb = 0;
    try {
      limiteMb = Number(buildPlanEntitlements(linha.plano)?.maxStorageMb || 0);
    } catch {
      limiteMb = 0;
    }
    const limiteBytes = limiteMb > 0 ? limiteMb * 1024 * 1024 : 0;
    return {
      id: linha.id,
      nome: linha.nome,
      plano: linha.plano,
      situacao: linha.situacao,
      isenta: Boolean(linha.isenta),
      arquivos: Number(linha.arquivos || 0),
      bytes,
      gb: Number((bytes / GB).toFixed(3)),
      limiteGb: limiteBytes ? Number((limiteBytes / GB).toFixed(3)) : null,
      fatiaUsada: limiteBytes ? Number((bytes / limiteBytes).toFixed(3)) : null,
      custoArmazenamentoMes: Number(((bytes / GB) * PRECO_ARMAZENAMENTO_GB).toFixed(2)),
    };
  });
}

/** O que a Bunny já cobrou neste mês, direto da fonte. Vale mais que estimativa. */
async function faturaDaBunny() {
  const chave = String(process.env.BUNNY_API_KEY || "").trim();
  if (!chave) return { disponivel: false, motivo: "sem BUNNY_API_KEY" };

  const axios = require("axios");
  try {
    const { data } = await axios.get("https://api.bunny.net/billing", {
      headers: { AccessKey: chave, Accept: "application/json" },
      timeout: 15000,
    });
    return {
      disponivel: true,
      saldoUsd: Number(data?.Balance || 0),
      gastoDoMesUsd: Number(data?.ThisMonthCharges || 0),
      detalhe: {
        armazenamentoUsd: Number(data?.MonthlyChargesStorage || 0),
        cdnUsd: Number(data?.MonthlyChargesCDN || 0),
        streamUsd: Number(data?.MonthlyChargesStream || 0),
      },
    };
  } catch (erro) {
    return { disponivel: false, motivo: erro?.message || "falha ao consultar a Bunny" };
  }
}

/** Tráfego do mês na pull zone, quando a chave da conta Bunny existir. */
async function trafegoDoMes() {
  const chave = String(process.env.BUNNY_API_KEY || "").trim();
  if (!chave) return { disponivel: false, motivo: "sem BUNNY_API_KEY" };

  const axios = require("axios");
  const agora = new Date();
  const inicio = new Date(agora.getFullYear(), agora.getMonth(), 1);
  try {
    const { data } = await axios.get("https://api.bunny.net/statistics", {
      headers: { AccessKey: chave, Accept: "application/json" },
      params: {
        dateFrom: inicio.toISOString().slice(0, 10),
        dateTo: agora.toISOString().slice(0, 10),
      },
      timeout: 15000,
    });
    const bytes = Number(data?.TotalBandwidthUsed || 0);
    return {
      disponivel: true,
      gb: Number((bytes / GB).toFixed(3)),
      custoMes: Number(((bytes / GB) * PRECO_TRAFEGO_GB).toFixed(2)),
      requisicoes: Number(data?.TotalRequestsServed || 0),
    };
  } catch (erro) {
    return { disponivel: false, motivo: erro?.message || "falha ao consultar a Bunny" };
  }
}

/** Retrato do mês: uso por conta, tráfego e custo estimado. */
async function resumoDeCustos(db = postgres) {
  const contas = await usoPorConta(db);
  const [trafego, fatura] = await Promise.all([trafegoDoMes(), faturaDaBunny()]);

  const bytesTotais = contas.reduce((soma, conta) => soma + conta.bytes, 0);

  // Quem cancelou continua ocupando espaço, e espaço ocupado é conta todo mês.
  // Sem olhar para isso, o custo de clientes que já foram embora só cresce.
  const abandonadas = contas.filter(
    (conta) => !conta.isenta && conta.bytes > 0 && SITUACOES_SEM_ASSINATURA.includes(conta.situacao || ""),
  );
  const bytesAbandonados = abandonadas.reduce((soma, conta) => soma + conta.bytes, 0);
  const estimadoArmazenamento = Number(((bytesTotais / GB) * PRECO_ARMAZENAMENTO_GB).toFixed(2));
  const estimadoTrafego = trafego.disponivel ? trafego.custoMes : 0;
  const estimadoTotal = Number((estimadoArmazenamento + estimadoTrafego).toFixed(2));

  // O que a Bunny cobrou manda; a estimativa só entra quando ela não responde.
  const custoTotalMes = fatura.disponivel ? fatura.gastoDoMesUsd : estimadoTotal;

  return {
    geradoEm: new Date().toISOString(),
    moeda: "USD",
    cambio: CAMBIO,
    precos: { armazenamentoGb: PRECO_ARMAZENAMENTO_GB, trafegoGb: PRECO_TRAFEGO_GB },
    fatura,
    totais: {
      contas: contas.length,
      arquivos: contas.reduce((soma, conta) => soma + conta.arquivos, 0),
      armazenamentoGb: Number((bytesTotais / GB).toFixed(3)),
      custoArmazenamentoMes: estimadoArmazenamento,
      custoTrafegoMes: estimadoTrafego,
      custoEstimadoMes: estimadoTotal,
      custoTotalMes,
      custoTotalMesBrl: Number((custoTotalMes * CAMBIO).toFixed(2)),
      fonte: fatura.disponivel ? "fatura da Bunny" : "estimativa pelo uso",
      tetoMensal: TETO_MENSAL,
    },
    semAssinatura: {
      contas: abandonadas.length,
      gb: Number((bytesAbandonados / GB).toFixed(3)),
      custoMes: Number(((bytesAbandonados / GB) * PRECO_ARMAZENAMENTO_GB).toFixed(2)),
      fatiaDoTotal: bytesTotais > 0 ? Number((bytesAbandonados / bytesTotais).toFixed(3)) : 0,
    },
    trafego,
    contas,
  };
}

/** Grava o aviso só uma vez por dia, para não repetir o mesmo e-mail. */
async function avisoInedito(db, tipo, referencia, detalhe) {
  await garantirSchema(db);
  const { rows } = await db.query(
    `
      INSERT INTO custos_avisos (tipo, referencia, detalhe)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (tipo, referencia, dia) DO NOTHING
      RETURNING id
    `,
    [tipo, referencia, JSON.stringify(detalhe || {})],
  );
  return rows.length > 0;
}

/**
 * Confere os limites e avisa por e-mail o que merece atenção.
 * Devolve o que foi encontrado, mesmo quando nada precisa de aviso.
 */
async function verificarCustos({ db = postgres, enviarEmail = true } = {}) {
  const resumo = await resumoDeCustos(db);
  const avisos = [];

  for (const conta of resumo.contas) {
    if (conta.isenta || !conta.fatiaUsada) continue;
    if (conta.fatiaUsada < FATIA_DE_AVISO) continue;
    const novo = await avisoInedito(db, "conta-perto-do-limite", conta.id, conta);
    if (novo) {
      avisos.push({
        tipo: "conta-perto-do-limite",
        conta: conta.nome,
        detalhe: `${conta.gb} GB de ${conta.limiteGb} GB (${Math.round(conta.fatiaUsada * 100)}%) no plano ${conta.plano}`,
      });
    }
  }

  if (resumo.totais.custoTotalMes >= TETO_MENSAL) {
    const novo = await avisoInedito(db, "teto-mensal", new Date().toISOString().slice(0, 7), resumo.totais);
    if (novo) {
      avisos.push({
        tipo: "teto-mensal",
        detalhe: `US$ ${resumo.totais.custoTotalMes.toFixed(2)} no mês, acima do teto de US$ ${TETO_MENSAL.toFixed(2)}`,
      });
    }
  }

  if (avisos.length > 0 && enviarEmail) {
    await enviarAvisoPorEmail(avisos, resumo).catch((erro) =>
      console.error("[custos] não consegui enviar o aviso:", erro?.message || erro),
    );
  }

  return { resumo, avisos };
}

async function enviarAvisoPorEmail(avisos, resumo) {
  const destino = process.env.CUSTOS_EMAIL_ALERTA || process.env.ENTERPRISE_REQUESTS_EMAIL;
  if (!destino) return;

  const { sendMail } = require("../server/email");
  const linhas = avisos.map((aviso) => `<li><strong>${aviso.conta || "Geral"}</strong>: ${aviso.detalhe}</li>`);
  await sendMail({
    to: destino,
    subject: "Pauta · atenção com o gasto de armazenamento",
    html: `
      <p>O acompanhamento diário encontrou o seguinte:</p>
      <ul>${linhas.join("")}</ul>
      <p>
        No mês: ${resumo.totais.armazenamentoGb} GB guardados, custo estimado de
US$ ${resumo.totais.custoTotalMes.toFixed(2)} (${resumo.totais.fonte})
        ${resumo.trafego.disponivel ? "" : " (sem o tráfego, que precisa da chave da conta Bunny)"}.
      </p>
    `,
  });
}

/** Confere uma vez por dia, como o backup e a limpeza. */
function iniciarVigilanciaDeCustos() {
  const umDia = 24 * 60 * 60 * 1000;
  const rodar = () =>
    verificarCustos()
      .then(({ avisos }) => {
        if (avisos.length > 0) console.log(`[custos] ${avisos.length} aviso(s) enviados`);
      })
      .catch((erro) => console.error("[custos] verificação falhou", erro?.message || erro));

  setTimeout(() => {
    rodar();
    setInterval(rodar, umDia);
  }, 2 * 60 * 1000).unref?.();
}

module.exports = {
  CAMBIO,
  FATIA_DE_AVISO,
  faturaDaBunny,
  TETO_MENSAL,
  garantirSchema,
  iniciarVigilanciaDeCustos,
  resumoDeCustos,
  trafegoDoMes,
  usoPorConta,
  verificarCustos,
};

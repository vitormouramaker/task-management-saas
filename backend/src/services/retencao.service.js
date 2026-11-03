const { postgres } = require("../server/connect");

/**
 * Retenção dos arquivos depois que a assinatura acaba.
 *
 * Quem cancela não perde nada no dia seguinte: os arquivos ficam por
 * `RETENCAO_DIAS` (padrão 90) para a pessoa voltar ou levar os dados embora.
 * Durante esse prazo chegam avisos por e-mail. Passado o prazo, os arquivos
 * são removidos da Bunny — e só eles: a conta, os cards e o histórico ficam.
 *
 * Nada é apagado enquanto `RETENCAO_REMOVER_ARQUIVOS` não for "1". Assim a
 * contagem e os avisos rodam primeiro, e a remoção só entra quando os Termos
 * de Uso já estiverem publicados.
 */
function numeroDoAmbiente(nome, padrao) {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === null || String(bruto).trim() === "") return padrao;
  const valor = Number(bruto);
  return Number.isFinite(valor) ? valor : padrao;
}

const DIAS_DE_RETENCAO = numeroDoAmbiente("RETENCAO_DIAS", 90);
// Avisos ao longo do prazo: logo após o cancelamento, na metade, e na véspera.
const MARCOS_DE_AVISO = [7, 30, DIAS_DE_RETENCAO - 7].filter(
  (dia, indice, lista) => dia > 0 && dia < DIAS_DE_RETENCAO && lista.indexOf(dia) === indice,
);
const REMOCAO_LIGADA = String(process.env.RETENCAO_REMOVER_ARQUIVOS || "") === "1";

const SITUACOES_ENCERRADAS = ["canceled", "unpaid", "incomplete_expired"];

/** Contas com assinatura encerrada, com quanto tempo faz e quanto ocupam. */
async function contasEncerradas(db = postgres) {
  const { rows } = await db.query(
    `
      SELECT o.id,
             o.name AS nome,
             o.subscription_status AS situacao,
             o.subscription_ended_at AS encerrada_em,
             o.retention_warned_days AS ultimo_aviso,
             o.files_purged_at AS arquivos_removidos_em,
             o.billing_exempt AS isenta,
             m.email AS email_do_dono,
             m.name AS nome_do_dono,
             FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - o.subscription_ended_at)) / 86400)::int AS dias,
             COALESCE(SUM(f.size_bytes) FILTER (WHERE f.deleted_at IS NULL), 0)::bigint AS bytes,
             COUNT(f.id) FILTER (WHERE f.deleted_at IS NULL)::int AS arquivos
      FROM organizations o
      LEFT JOIN members m ON m.id = o.owner_member_id
      LEFT JOIN storage_files f ON f.organization_id = o.id
      WHERE o.subscription_ended_at IS NOT NULL
        AND o.subscription_status = ANY($1)
        AND o.billing_exempt IS NOT TRUE
      GROUP BY o.id, o.name, o.subscription_status, o.subscription_ended_at,
               o.retention_warned_days, o.files_purged_at, o.billing_exempt, m.email, m.name
      ORDER BY o.subscription_ended_at
    `,
    [SITUACOES_ENCERRADAS],
  );

  return rows.map((linha) => ({
    id: linha.id,
    nome: linha.nome,
    situacao: linha.situacao,
    encerradaEm: linha.encerrada_em,
    dias: Number(linha.dias || 0),
    diasRestantes: Math.max(0, DIAS_DE_RETENCAO - Number(linha.dias || 0)),
    ultimoAviso: Number(linha.ultimo_aviso || 0),
    arquivosRemovidosEm: linha.arquivos_removidos_em,
    emailDoDono: linha.email_do_dono,
    nomeDoDono: linha.nome_do_dono,
    arquivos: Number(linha.arquivos || 0),
    bytes: Number(linha.bytes || 0),
    gb: Number((Number(linha.bytes || 0) / (1024 * 1024 * 1024)).toFixed(3)),
  }));
}

/** O que aconteceria hoje, sem mudar nada. É o padrão de quem roda na mão. */
async function simular(db = postgres) {
  const contas = await contasEncerradas(db);
  const aAvisar = [];
  const aRemover = [];

  for (const conta of contas) {
    if (conta.arquivosRemovidosEm) continue;

    if (conta.dias >= DIAS_DE_RETENCAO) {
      if (conta.arquivos > 0) aRemover.push(conta);
      continue;
    }

    const marco = MARCOS_DE_AVISO.filter((dia) => conta.dias >= dia).pop();
    if (marco && marco > conta.ultimoAviso) {
      aAvisar.push({ ...conta, marco });
    }
  }

  return {
    diasDeRetencao: DIAS_DE_RETENCAO,
    marcosDeAviso: MARCOS_DE_AVISO,
    remocaoLigada: REMOCAO_LIGADA,
    contas,
    aAvisar,
    aRemover,
    gbARemover: Number(aRemover.reduce((soma, conta) => soma + conta.gb, 0).toFixed(3)),
  };
}

function textoDoAviso(conta) {
  const quando =
    conta.diasRestantes <= 10
      ? `nos próximos ${conta.diasRestantes} dia(s)`
      : `em ${conta.diasRestantes} dias`;

  return {
    assunto:
      conta.diasRestantes <= 10
        ? "Seus arquivos no Pauta serão removidos em breve"
        : "Seus arquivos no Pauta continuam guardados",
    html: `
      <p>Olá${conta.nomeDoDono ? `, ${conta.nomeDoDono}` : ""}.</p>
      <p>
        A assinatura da conta <strong>${conta.nome}</strong> foi encerrada em
        ${new Date(conta.encerradaEm).toLocaleDateString("pt-BR")}. Desde então
        guardamos seus arquivos — hoje são ${conta.arquivos} arquivo(s),
        ${conta.gb} GB.
      </p>
      <p>
        Eles ficam disponíveis por ${DIAS_DE_RETENCAO} dias após o encerramento,
        ou seja, ${quando}. Depois disso serão removidos.
      </p>
      <p>
        Para manter tudo, basta assinar um plano de novo. Para levar os arquivos,
        use a exportação de dados nas configurações da conta.
      </p>
    `,
  };
}

/** Manda os avisos do dia e anota qual marco cada conta já recebeu. */
async function avisar({ db = postgres, enviarEmail = true } = {}) {
  const { aAvisar } = await simular(db);
  const enviados = [];

  for (const conta of aAvisar) {
    if (enviarEmail && conta.emailDoDono) {
      try {
        const { sendMail } = require("../server/email");
        const { assunto, html } = textoDoAviso(conta);
        await sendMail({ to: conta.emailDoDono, subject: assunto, html });
      } catch (erro) {
        console.error("[retencao] não consegui avisar", conta.id, erro?.message || erro);
        continue;
      }
    }

    await db.query("UPDATE organizations SET retention_warned_days = $2 WHERE id = $1", [
      conta.id,
      conta.marco,
    ]);
    enviados.push({ id: conta.id, nome: conta.nome, marco: conta.marco, dias: conta.dias });
  }

  return enviados;
}

/**
 * Remove os arquivos de quem passou do prazo.
 *
 * Só roda de verdade com `aplicar: true` **e** `RETENCAO_REMOVER_ARQUIVOS=1`:
 * apagar arquivo de cliente não é coisa que deva acontecer por descuido de
 * configuração.
 */
async function removerArquivosVencidos({ db = postgres, aplicar = false } = {}) {
  const { aRemover } = await simular(db);
  const resultado = { avaliadas: aRemover.length, removidas: 0, arquivos: 0, gb: 0, contas: [] };

  for (const conta of aRemover) {
    resultado.contas.push({ id: conta.id, nome: conta.nome, dias: conta.dias, gb: conta.gb });
    resultado.arquivos += conta.arquivos;
    resultado.gb = Number((resultado.gb + conta.gb).toFixed(3));

    if (!aplicar || !REMOCAO_LIGADA) continue;

    const { rows } = await db.query(
      "SELECT url FROM storage_files WHERE organization_id = $1 AND deleted_at IS NULL",
      [conta.id],
    );
    const { releaseStorageUrls } = require("./storage.service");
    releaseStorageUrls(rows.map((linha) => linha.url));

    await db.query(
      `
        INSERT INTO storage_access_log (storage_path, organization_id, action, user_agent)
        VALUES ($1, $2, 'retencao', $3)
      `,
      [
        `conta:${conta.id}`,
        conta.id,
        `remocao apos ${DIAS_DE_RETENCAO} dias sem assinatura (${conta.arquivos} arquivos, ${conta.gb} GB)`,
      ],
    );

    await db.query("UPDATE organizations SET files_purged_at = CURRENT_TIMESTAMP WHERE id = $1", [
      conta.id,
    ]);
    resultado.removidas += 1;
  }

  resultado.aplicado = aplicar && REMOCAO_LIGADA;
  return resultado;
}

/** Roda uma vez por dia: avisa sempre, remove só se estiver ligado. */
function iniciarRetencao() {
  const umDia = 24 * 60 * 60 * 1000;
  const rodar = async () => {
    try {
      const enviados = await avisar({});
      if (enviados.length > 0) console.log(`[retencao] ${enviados.length} aviso(s) enviados`);

      const remocao = await removerArquivosVencidos({ aplicar: true });
      if (remocao.avaliadas > 0) {
        console.log(
          remocao.aplicado
            ? `[retencao] ${remocao.removidas} conta(s) tiveram os arquivos removidos (${remocao.gb} GB)`
            : `[retencao] ${remocao.avaliadas} conta(s) passaram do prazo; remoção desligada (RETENCAO_REMOVER_ARQUIVOS)`,
        );
      }
    } catch (erro) {
      console.error("[retencao] falhou", erro?.message || erro);
    }
  };

  setTimeout(() => {
    rodar();
    setInterval(rodar, umDia);
  }, 3 * 60 * 1000).unref?.();
}

module.exports = {
  DIAS_DE_RETENCAO,
  MARCOS_DE_AVISO,
  REMOCAO_LIGADA,
  avisar,
  contasEncerradas,
  iniciarRetencao,
  removerArquivosVencidos,
  simular,
};

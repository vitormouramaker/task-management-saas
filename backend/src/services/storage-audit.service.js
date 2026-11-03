const { postgres } = require("../server/connect");

/**
 * Trilha de acesso aos arquivos.
 *
 * O download acontece direto na CDN da Bunny, então o servidor não vê o
 * byte saindo. O que ele sabe, e o que fica registrado aqui, é **a quem e
 * quando entregou o link temporário** de cada arquivo — com usuário
 * autenticado, IP e navegador. É isso que responde a um pedido judicial:
 * "o sistema liberou este arquivo para esta pessoa, nesta hora, deste IP".
 *
 * Como uma única tela pode trazer dezenas de anexos, o mesmo par
 * pessoa + arquivo só é gravado de novo depois da janela de silêncio.
 */
/** Lê número do ambiente aceitando zero (útil nos testes), que `|| padrão` descartaria. */
function numeroDoAmbiente(nome, padrao) {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === null || String(bruto).trim() === "") return padrao;
  const valor = Number(bruto);
  return Number.isFinite(valor) ? valor : padrao;
}

const JANELA_SILENCIO_MS = numeroDoAmbiente("STORAGE_AUDIT_WINDOW_MS", 30 * 60 * 1000);
const LIMITE_FILA = 500;

const vistosRecentemente = new Map();
let fila = [];
let gravando = false;

function chaveDedupe(membroId, caminho) {
  return `${membroId || "anonimo"}|${caminho}`;
}

function limparVistosAntigos(agora) {
  for (const [chave, quando] of vistosRecentemente) {
    if (agora - quando > JANELA_SILENCIO_MS) vistosRecentemente.delete(chave);
  }
}

/** Marca que um link foi entregue. Não espera o banco: a tela não pode travar por isso. */
function registrarEntregaDeLink({ storagePath, organizationId, memberId, ip, userAgent, action = "link" }) {
  if (!storagePath) return;

  const agora = Date.now();
  const chave = chaveDedupe(memberId, storagePath);
  const ultimo = vistosRecentemente.get(chave);
  if (ultimo && agora - ultimo < JANELA_SILENCIO_MS) return;

  vistosRecentemente.set(chave, agora);
  if (vistosRecentemente.size > 5000) limparVistosAntigos(agora);

  if (fila.length >= LIMITE_FILA) return;
  fila.push({
    storagePath,
    organizationId: organizationId || null,
    memberId: memberId || null,
    ip: ip ? String(ip).slice(0, 60) : null,
    userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    action,
  });
  void gravarFila();
}

async function gravarFila() {
  if (gravando || fila.length === 0) return;
  gravando = true;
  const lote = fila;
  fila = [];

  try {
    const valores = [];
    const marcadores = lote.map((item, indice) => {
      const base = indice * 6;
      valores.push(item.storagePath, item.organizationId, item.memberId, item.action, item.ip, item.userAgent);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    await postgres.query(
      `
        INSERT INTO storage_access_log
          (storage_path, organization_id, member_id, action, ip, user_agent)
        VALUES ${marcadores.join(", ")}
      `,
      valores,
    );
  } catch (erro) {
    // Auditoria não pode derrubar requisição: anota e segue.
    console.warn("[auditoria] não consegui gravar o acesso a arquivo:", erro?.message || erro);
  } finally {
    gravando = false;
    if (fila.length > 0) void gravarFila();
  }
}

/**
 * Apaga registros antigos.
 *
 * O Marco Civil da Internet (art. 15) pede seis meses de guarda; a LGPD pede
 * para não guardar além do necessário. O padrão de 24 meses fica no meio, e
 * `STORAGE_AUDIT_RETENTION_DAYS` ajusta.
 */
async function limparRegistrosAntigos(db = postgres) {
  const dias = numeroDoAmbiente("STORAGE_AUDIT_RETENTION_DAYS", 730);
  const { rowCount } = await db.query(
    `DELETE FROM storage_access_log WHERE created_at < CURRENT_TIMESTAMP - ($1 || ' days')::interval`,
    [String(dias)],
  );
  return { apagados: rowCount || 0, dias };
}

/** Roda a limpeza uma vez por dia, como os outros serviços fazem. */
function iniciarLimpezaDaTrilha() {
  const umDia = 24 * 60 * 60 * 1000;
  const rodar = () =>
    limparRegistrosAntigos()
      .then(({ apagados, dias }) => {
        if (apagados > 0) {
          console.log(`[auditoria] ${apagados} registro(s) com mais de ${dias} dias removido(s)`);
        }
      })
      .catch((erro) => console.error("[auditoria] limpeza falhou", erro?.message));

  setTimeout(() => {
    rodar();
    setInterval(rodar, umDia);
  }, 90 * 1000).unref?.();
}

module.exports = {
  JANELA_SILENCIO_MS,
  iniciarLimpezaDaTrilha,
  limparRegistrosAntigos,
  registrarEntregaDeLink,
};

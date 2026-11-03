const crypto = require("crypto");
const { postgres } = require("../server/connect");

/**
 * Notas fiscais de serviço (NFS-e).
 *
 * A empresa (Simples Nacional) emite as notas pelo site da
 * prefeitura. Por isso o Pauta não emite sozinho: cada fatura paga na Stripe
 * vira um pedido "pendente" no painel, com os dados prontos para copiar. Depois
 * de emitir, a equipe registra número e link, e o cliente recebe por e-mail e
 * vê a nota na tela de Pagamentos.
 *
 * Se um dia a emissão passar a ser por API (emissor nacional ou provedor), é só
 * trocar o passo manual por uma chamada aqui.
 */

const NFSE_STATUSES = ["pendente", "emitida", "cancelada", "nao_emitir"];

let schemaReady = null;

/** Cria as tabelas. Aceita outro pool, que é o caso dos testes. */
function ensureNfseSchema(db = postgres) {
  if (db !== postgres) return criarTabelas(db);
  if (!schemaReady) {
    schemaReady = criarTabelas(postgres).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function criarTabelas(db) {
  await db.query(`
        CREATE TABLE IF NOT EXISTS nfse_records (
          id VARCHAR(100) PRIMARY KEY,
          organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE SET NULL,
          stripe_invoice_id VARCHAR(120) NOT NULL UNIQUE,
          stripe_invoice_number VARCHAR(120),
          amount_cents INTEGER NOT NULL,
          paid_at TIMESTAMPTZ,
          competence VARCHAR(7),
          customer_name VARCHAR(255),
          customer_document VARCHAR(20),
          customer_document_type VARCHAR(4),
          customer_email VARCHAR(255),
          customer_address JSONB,
          service_description TEXT,
          status VARCHAR(20) NOT NULL DEFAULT 'pendente',
          nfse_number VARCHAR(60),
          verification_code VARCHAR(120),
          document_url TEXT,
          notes TEXT,
          issued_at TIMESTAMPTZ,
          issued_by VARCHAR(100),
          email_sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
  `);

  // Emissão automática: guarda o que foi enviado e o que a prefeitura devolveu.
  for (const coluna of [
    "ALTER TABLE nfse_records ADD COLUMN IF NOT EXISTS dps_number INTEGER",
    "ALTER TABLE nfse_records ADD COLUMN IF NOT EXISTS dps_series VARCHAR(5)",
    "ALTER TABLE nfse_records ADD COLUMN IF NOT EXISTS access_key VARCHAR(60)",
    "ALTER TABLE nfse_records ADD COLUMN IF NOT EXISTS last_error TEXT",
    "ALTER TABLE nfse_records ADD COLUMN IF NOT EXISTS auto_attempts INTEGER NOT NULL DEFAULT 0",
  ]) {
    await db.query(coluna);
  }

  await db.query(
    "CREATE INDEX IF NOT EXISTS nfse_records_status_idx ON nfse_records (status, paid_at)",
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS nfse_records_org_idx ON nfse_records (organization_id, paid_at DESC)",
  );
}

class NfseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatDateBr(seconds) {
  return seconds ? new Date(seconds * 1000).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;
}

function formatBrl(cents) {
  return (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Texto sugerido para o campo "Discriminação do serviço" da nota. */
function buildServiceDescription(invoice) {
  const linhas = (invoice.lines?.data || [])
    .filter((line) => Number(line.amount || 0) !== 0)
    .map((line) => `${line.description || "Assinatura Pauta"}: ${formatBrl(line.amount)}`);

  const inicio = formatDateBr(invoice.period_start || invoice.lines?.data?.[0]?.period?.start);
  const fim = formatDateBr(invoice.period_end || invoice.lines?.data?.[0]?.period?.end);

  return [
    "Licença de uso do software Pauta (software como serviço - gestão de tarefas e projetos).",
    ...linhas,
    inicio && fim ? `Período: ${inicio} a ${fim}.` : null,
    invoice.number ? `Referente à fatura ${invoice.number}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Qual produto foi vendido nesta fatura, para escolher o código do serviço. */
function produtoDaFatura(invoice) {
  const linha = (invoice?.lines?.data || []).find((item) => Number(item.amount || 0) > 0);
  return (
    invoice?.subscription_details?.metadata?.planId ||
    invoice?.lines?.data?.[0]?.metadata?.planId ||
    linha?.price?.id ||
    null
  );
}

/** Próximo número da DPS na série, que é sequencial e só nosso. */
async function proximoNumeroDps(db) {
  const { rows } = await db.query(
    "SELECT COALESCE(MAX(dps_number), 0) + 1 AS proximo FROM nfse_records",
  );
  return Number(rows[0]?.proximo || 1);
}

/**
 * Emite a nota pela API da prefeitura e guarda o resultado no pedido.
 *
 * Nunca estoura: nota que não sai vira pendência com o motivo anotado, e a
 * cobrança segue o seu caminho. Quem emite à mão continua podendo, pela tela.
 */
async function emitirAutomaticamente(registroId, invoice, db = postgres) {
  const prefeitura = require("./nfse-municipal.service");
  if (!prefeitura.emissaoAutomaticaLigada()) {
    return { emitida: false, motivo: "emissao_automatica_desligada" };
  }

  const { rows } = await db.query(
    "SELECT * FROM nfse_records WHERE id = $1 AND status = 'pendente'",
    [registroId],
  );
  const registro = rows[0];
  if (!registro) return { emitida: false, motivo: "registro_nao_encontrado" };
  if (!registro.customer_document) {
    return await anotarFalha(db, registroId, "Falta o CPF ou CNPJ do cliente.");
  }

  const { enderecoParaDps } = require("./municipio.service");
  const endereco = await enderecoParaDps(registro.customer_address);
  if (!endereco) {
    return await anotarFalha(
      db,
      registroId,
      "Falta o endereço do cliente, que a prefeitura exige (CEP, rua e bairro).",
    );
  }

  const numero = await proximoNumeroDps(db);
  const produto = produtoDaFatura(invoice);

  try {
    const nota = await prefeitura.emitir({
      numero,
      competencia: new Date(registro.paid_at || Date.now()).toISOString().slice(0, 10),
      valorCentavos: registro.amount_cents,
      descricao: registro.service_description,
      produto,
      tomador: {
        documento: registro.customer_document,
        nome: registro.customer_name,
        email: registro.customer_email,
        endereco,
      },
    });

    await db.query(
      `
        UPDATE nfse_records
        SET status = 'emitida',
            nfse_number = COALESCE($2, nfse_number),
            access_key = $3,
            dps_number = $4,
            dps_series = $5,
            document_url = COALESCE($6, document_url),
            issued_at = CURRENT_TIMESTAMP,
            last_error = NULL,
            auto_attempts = auto_attempts + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [
        registroId,
        nota.numeroNfse || null,
        nota.chaveAcesso || null,
        numero,
        prefeitura.configuracao({ produto }).serie,
        nota.chaveAcesso ? linkDaNota(nota.chaveAcesso) : null,
      ],
    );
    return { emitida: true, chaveAcesso: nota.chaveAcesso };
  } catch (erro) {
    const detalhe = erro?.detalhe?.erros
      ? erro.detalhe.erros.map((item) => `${item.codigo} ${item.mensagem}`).join(" | ")
      : erro?.message || "falha desconhecida";
    return await anotarFalha(db, registroId, detalhe);
  }
}

/** Link público da nota no portal da prefeitura. */
function linkDaNota(chaveAcesso) {
  return `https://www.nfse.gov.br/consultapublica/?chave=${chaveAcesso}`;
}

async function anotarFalha(db, registroId, motivo) {
  await db.query(
    `
      UPDATE nfse_records
      SET last_error = $2,
          auto_attempts = auto_attempts + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [registroId, String(motivo).slice(0, 1000)],
  );
  console.warn("[nfse] emissão automática não saiu:", registroId, motivo);
  return { emitida: false, motivo };
}

/** Cria o pedido de nota para uma fatura paga (idempotente). */
async function recordPaidInvoice(invoice, db = postgres) {
  await ensureNfseSchema(db);

  const amount = Number(invoice?.amount_paid || 0);
  if (!invoice?.id || amount <= 0 || !invoice.customer) {
    return { recorded: false, reason: "sem_valor" };
  }

  const orgResult = await db.query(
    `
      SELECT o.id, o.name, o.legal_name, o.cnpj, o.account_type, o.billing_exempt,
             m.name AS owner_name, m.cpf AS owner_cpf, m.email AS owner_email
      FROM organizations o
      LEFT JOIN members m ON m.id = o.owner_member_id
      WHERE o.stripe_customer_id = $1
    `,
    [invoice.customer],
  );
  const org = orgResult.rows[0] || null;

  // Tomador: dados da conta no Pauta; o que faltar vem da Stripe.
  const stripeTaxId = onlyDigits(invoice.customer_tax_ids?.[0]?.value);
  let document = null;
  let documentType = null;
  let name = invoice.customer_name || null;

  if (org?.cnpj) {
    document = org.cnpj;
    documentType = "CNPJ";
    name = org.legal_name || org.name || name;
  } else if (org?.owner_cpf) {
    document = org.owner_cpf;
    documentType = "CPF";
    name = org.owner_name || name;
  } else if (stripeTaxId.length === 14 || stripeTaxId.length === 11) {
    document = stripeTaxId;
    documentType = stripeTaxId.length === 14 ? "CNPJ" : "CPF";
  }

  const paidSeconds = invoice.status_transitions?.paid_at || invoice.created;
  const paidAt = paidSeconds ? new Date(paidSeconds * 1000) : new Date();
  const competence = paidAt.toISOString().slice(0, 7);

  const result = await db.query(
    `
      INSERT INTO nfse_records (
        id, organization_id, stripe_invoice_id, stripe_invoice_number, amount_cents, paid_at,
        competence, customer_name, customer_document, customer_document_type, customer_email,
        customer_address, service_description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
      ON CONFLICT (stripe_invoice_id) DO NOTHING
      RETURNING id
    `,
    [
      `nf_${crypto.randomBytes(8).toString("hex")}`,
      org?.id || null,
      invoice.id,
      invoice.number || null,
      amount,
      paidAt,
      competence,
      name,
      document,
      documentType,
      invoice.customer_email || org?.owner_email || null,
      invoice.customer_address ? JSON.stringify(invoice.customer_address) : null,
      buildServiceDescription(invoice),
    ],
  );

  const registroId = result.rows[0]?.id || null;
  if (registroId) {
    // A nota é consequência do pagamento, não condição: se falhar, fica pendente.
    const emissao = await emitirAutomaticamente(registroId, invoice, db).catch((erro) => ({
      emitida: false,
      motivo: erro?.message || "falha inesperada",
    }));
    return { recorded: true, organizationId: org?.id || null, emissao };
  }

  return { recorded: false, organizationId: org?.id || null };
}

function serializeRecord(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name || null,
    stripeInvoiceId: row.stripe_invoice_id,
    stripeInvoiceNumber: row.stripe_invoice_number,
    amountCents: row.amount_cents,
    paidAt: row.paid_at,
    competence: row.competence,
    customerName: row.customer_name,
    customerDocument: row.customer_document,
    customerDocumentType: row.customer_document_type,
    customerEmail: row.customer_email,
    customerAddress: row.customer_address,
    serviceDescription: row.service_description,
    status: row.status,
    nfseNumber: row.nfse_number,
    verificationCode: row.verification_code,
    documentUrl: row.document_url,
    notes: row.notes,
    accessKey: row.access_key || null,
    dpsNumber: row.dps_number || null,
    dpsSeries: row.dps_series || null,
    lastError: row.last_error || null,
    autoAttempts: row.auto_attempts || 0,
    issuedAt: row.issued_at,
    issuedByName: row.issued_by_name || null,
    emailSentAt: row.email_sent_at,
    createdAt: row.created_at,
  };
}

async function listRecords({ status, search, page = 0 }) {
  await ensureNfseSchema();
  const filters = [];
  const params = [];

  if (status && NFSE_STATUSES.includes(status)) {
    params.push(status);
    filters.push(`n.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${String(search).toLowerCase()}%`);
    filters.push(
      `(lower(COALESCE(n.customer_name, '')) LIKE $${params.length} OR n.customer_document LIKE $${params.length} OR lower(COALESCE(o.name, '')) LIKE $${params.length} OR lower(COALESCE(n.stripe_invoice_number, '')) LIKE $${params.length})`,
    );
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const pageSize = 30;
  params.push(pageSize, Math.max(0, Number(page) || 0) * pageSize);

  const [rows, counts, total] = await Promise.all([
    postgres.query(
      `
        SELECT n.*, o.name AS organization_name, m.name AS issued_by_name
        FROM nfse_records n
        LEFT JOIN organizations o ON o.id = n.organization_id
        LEFT JOIN members m ON m.id = n.issued_by
        ${where}
        ORDER BY CASE n.status WHEN 'pendente' THEN 0 ELSE 1 END, n.paid_at ASC NULLS LAST
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    ),
    postgres.query("SELECT status, COUNT(*)::int AS total FROM nfse_records GROUP BY status"),
    postgres.query(
      `SELECT COUNT(*)::int AS total FROM nfse_records n LEFT JOIN organizations o ON o.id = n.organization_id ${where}`,
      params.slice(0, -2),
    ),
  ]);

  return {
    records: rows.rows.map(serializeRecord),
    counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.total])),
    total: total.rows[0].total,
    pageSize,
    serviceCode: process.env.NFSE_SERVICE_CODE || null,
  };
}

async function sendIssuedEmail(record) {
  if (!record.customer_email || !record.document_url) return false;
  const { sendSupportEmail } = require("../server/email");
  await sendSupportEmail({
    to: record.customer_email,
    subject: `Nota fiscal do Pauta nº ${record.nfse_number}`,
    title: "Sua nota fiscal está disponível",
    paragraphs: [
      "Olá!",
      `A nota fiscal de serviço nº <strong>${String(record.nfse_number).replace(/[<>&"]/g, "")}</strong>, referente ao pagamento de ${formatBrl(record.amount_cents)} da sua assinatura do Pauta, foi emitida.`,
      "Você também encontra a nota em Configurações &gt; Pagamentos.",
    ],
    buttonLabel: "Ver nota fiscal",
    url: record.document_url,
    footer: "Guarde este e-mail para a sua contabilidade.",
  });
  return true;
}

async function updateRecord(id, body, adminId) {
  await ensureNfseSchema();
  const current = await postgres.query("SELECT * FROM nfse_records WHERE id = $1", [id]);
  const record = current.rows[0];
  if (!record) throw new NfseError(404, "Pedido de nota não encontrado.");

  const status = body.status ?? record.status;
  if (!NFSE_STATUSES.includes(status)) throw new NfseError(400, "Situação inválida.");

  const nfseNumber = body.nfseNumber !== undefined ? String(body.nfseNumber || "").trim() || null : record.nfse_number;
  const verificationCode =
    body.verificationCode !== undefined ? String(body.verificationCode || "").trim() || null : record.verification_code;
  const documentUrl = body.documentUrl !== undefined ? String(body.documentUrl || "").trim() || null : record.document_url;
  const notes = body.notes !== undefined ? String(body.notes || "").slice(0, 2000) || null : record.notes;

  if (status === "emitida" && !nfseNumber) {
    throw new NfseError(400, "Informe o número da nota emitida.");
  }
  if (documentUrl && !/^https:\/\//i.test(documentUrl)) {
    throw new NfseError(400, "O link da nota precisa começar com https://.");
  }
  if (status === "nao_emitir" && !notes) {
    throw new NfseError(400, "Explique por que esta fatura não terá nota.");
  }

  const updated = await postgres.query(
    `
      UPDATE nfse_records
      SET status = $2::varchar, nfse_number = $3, verification_code = $4, document_url = $5, notes = $6,
          issued_at = CASE WHEN $2::varchar = 'emitida' THEN COALESCE(issued_at, CURRENT_TIMESTAMP) ELSE issued_at END,
          issued_by = CASE WHEN $2::varchar = 'emitida' THEN COALESCE(issued_by, $7::varchar) ELSE issued_by END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `,
    [id, status, nfseNumber, verificationCode, documentUrl, notes, adminId],
  );
  // Relê com os nomes da conta e de quem emitiu, para a resposta ficar completa.
  const comNomes = async () =>
    (
      await postgres.query(
        `
          SELECT n.*, o.name AS organization_name, m.name AS issued_by_name
          FROM nfse_records n
          LEFT JOIN organizations o ON o.id = n.organization_id
          LEFT JOIN members m ON m.id = n.issued_by
          WHERE n.id = $1
        `,
        [id],
      )
    ).rows[0];

  let row = await comNomes();

  if (row.status === "emitida" && !row.email_sent_at && body.sendEmail !== false && row.document_url) {
    if (await sendIssuedEmail(row).catch(() => false)) {
      await postgres.query("UPDATE nfse_records SET email_sent_at = CURRENT_TIMESTAMP WHERE id = $1", [id]);
      row = await comNomes();
    }
  }

  return serializeRecord(row);
}

/** Traz faturas pagas que o webhook possa ter perdido. */
async function syncPaidInvoicesFromStripe({ days = 90 } = {}) {
  const { stripe, isStripeEnabled } = require("../config/stripe");
  if (!isStripeEnabled()) throw new NfseError(503, "Stripe não configurada.");

  const since = Math.floor(Date.now() / 1000) - days * 86400;
  let created = 0;
  let startingAfter;

  for (let pagina = 0; pagina < 20; pagina += 1) {
    const list = await stripe.invoices.list({
      status: "paid",
      created: { gte: since },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const invoice of list.data) {
      const result = await recordPaidInvoice(invoice);
      if (result.recorded) created += 1;
    }
    if (!list.has_more || !list.data.length) break;
    startingAfter = list.data[list.data.length - 1].id;
  }

  return { created };
}

/** Notas emitidas da conta, por fatura da Stripe (tela de Pagamentos). */
async function mapIssuedByInvoice(organizationId) {
  await ensureNfseSchema();
  const result = await postgres.query(
    "SELECT stripe_invoice_id, status, nfse_number, document_url, issued_at FROM nfse_records WHERE organization_id = $1",
    [organizationId],
  );
  return new Map(
    result.rows.map((row) => [
      row.stripe_invoice_id,
      {
        status: row.status,
        number: row.status === "emitida" ? row.nfse_number : null,
        url: row.status === "emitida" ? row.document_url : null,
        issuedAt: row.issued_at,
      },
    ]),
  );
}

module.exports = {
  NFSE_STATUSES,
  emitirAutomaticamente,
  produtoDaFatura,
  NfseError,
  ensureNfseSchema,
  listRecords,
  mapIssuedByInvoice,
  recordPaidInvoice,
  syncPaidInvoicesFromStripe,
  updateRecord,
};

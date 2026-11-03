const { postgres } = require("../server/connect");
const { sendPlanNoticeEmail } = require("../server/email");
const {
  getOrganizationUsage,
  resolveOrganizationBilling,
  PAYMENT_READ_ONLY_DAYS,
  PAYMENT_WARNING_DAYS,
} = require("./billing.service");

/**
 * Avisos que o Pauta manda por conta própria: fim do teste, limite chegando
 * e fatura em aberto. A Stripe cuida só dos e-mails de cobrança dela.
 */
const ALERTA_DE_USO = 0.8;
const INTERVALO_WORKER_MS = 6 * 60 * 60 * 1000;
// Não repetimos o mesmo aviso antes disso (evita encher a caixa de entrada).
const JANELA_PADRAO_DIAS = 14;

const RECURSOS = {
  users: "pessoas",
  workspaces: "espaços de trabalho",
  projects: "projetos",
  storage: "armazenamento",
};

let schemaReady = null;

function ensureBillingNoticeSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      await postgres.query(`
        CREATE TABLE IF NOT EXISTS billing_notices (
          id SERIAL PRIMARY KEY,
          organization_id VARCHAR(100) NOT NULL,
          kind VARCHAR(60) NOT NULL,
          sent_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await postgres.query(
        "CREATE INDEX IF NOT EXISTS billing_notices_org_kind_idx ON billing_notices (organization_id, kind, sent_at DESC)",
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}

/** Já mandamos esse aviso para essa conta há pouco tempo? */
async function jaAvisado(organizationId, kind, dias = JANELA_PADRAO_DIAS) {
  const result = await postgres.query(
    `
      SELECT 1 FROM billing_notices
      WHERE organization_id = $1 AND kind = $2
        AND sent_at > CURRENT_TIMESTAMP - ($3 || ' days')::interval
      LIMIT 1
    `,
    [organizationId, kind, String(dias)],
  );

  return result.rows.length > 0;
}

async function registrarAviso(organizationId, kind) {
  await postgres.query(
    "INSERT INTO billing_notices (organization_id, kind) VALUES ($1, $2)",
    [organizationId, kind],
  );
}

/** Titular e administradores da conta, com e-mail confirmado. */
async function destinatarios(organizationId) {
  const result = await postgres.query(
    `
      SELECT m.email, m.name
      FROM organization_members om
      INNER JOIN members m ON m.id = om.member_id
      WHERE om.organization_id = $1
        AND om.status = 'active'
        AND om.role IN ('owner', 'admin')
        AND m.email_verified_at IS NOT NULL
        AND m.email NOT LIKE 'removido+%'
    `,
    [organizationId],
  );

  return result.rows;
}

async function enviarAviso(organization, kind, { subject, title, paragraphs, buttonLabel }) {
  if (await jaAvisado(organization.id, kind)) {
    return false;
  }

  const pessoas = await destinatarios(organization.id);
  if (pessoas.length === 0) {
    return false;
  }

  for (const pessoa of pessoas) {
    await sendPlanNoticeEmail({
      to: pessoa.email,
      name: pessoa.name,
      subject,
      title,
      paragraphs,
      buttonLabel,
    });
  }

  await registrarAviso(organization.id, kind);
  return true;
}

function formatarData(data) {
  return data ? new Date(data).toLocaleDateString("pt-BR") : "";
}

/** Decide quais avisos a conta merece hoje e envia. */
async function avaliarConta(organization) {
  const billing = resolveOrganizationBilling(organization);
  if (billing.isExempt) {
    return [];
  }

  const enviados = [];
  const nome = organization.name;

  // 1. Teste grátis acabando (3 dias ou menos) e teste encerrado.
  if (billing.isTrial && billing.trialDaysLeft <= 3) {
    const enviado = await enviarAviso(organization, "trial_acabando", {
      subject: `Seu teste do Pauta termina em ${billing.trialDaysLeft} dia(s)`,
      title: "Seu teste está acabando",
      paragraphs: [
        `O teste do plano Profissional da conta <strong>${nome}</strong> termina em <strong>${billing.trialDaysLeft} dia(s)</strong>, em ${formatarData(billing.trialEndsAt)}.`,
        "Quando o teste terminar, a conta volta para o plano Grátis. Nada do que vocês criaram é apagado — mas, se o uso estiver acima dos limites do Grátis, a conta fica somente leitura até escolher um plano.",
        "Para continuar com tudo funcionando, escolha um plano antes dessa data.",
      ],
      buttonLabel: "Ver planos",
    });
    if (enviado) enviados.push("trial_acabando");
  }

  if (billing.trialExpired) {
    const enviado = await enviarAviso(organization, "trial_encerrado", {
      subject: "Seu teste do Pauta terminou",
      title: "O teste terminou",
      paragraphs: [
        `O teste do plano Profissional da conta <strong>${nome}</strong> chegou ao fim e ela voltou para o plano Grátis.`,
        "Todos os espaços de trabalho, projetos, cards e arquivos continuam salvos. Se o uso estiver acima dos limites do Grátis, é possível ver e baixar tudo, mas não criar nem editar até escolher um plano ou remover itens.",
      ],
      buttonLabel: "Escolher um plano",
    });
    if (enviado) enviados.push("trial_encerrado");
  }

  // 2. Limites chegando perto ou estourados.
  const uso = await getOrganizationUsage(organization.id);
  const limites = billing.entitlements;
  const pares = [
    ["users", uso.users, limites.seats],
    ["espaços de trabalho", uso.workspaces, limites.maxWorkspaces],
    ["projects", uso.projects, limites.maxProjects],
    ["storage", uso.storageMb, limites.maxStorageMb],
  ];

  for (const [recurso, usado, limite] of pares) {
    if (limite === -1 || limite === 0) continue;

    const proporcao = usado / limite;
    if (proporcao < ALERTA_DE_USO) continue;

    const estourou = proporcao >= 1;
    const kind = `limite_${recurso}_${estourou ? "atingido" : "proximo"}`;
    const rotulo = RECURSOS[recurso];
    const quantidade =
      recurso === "storage"
        ? `${Math.round(usado)} MB de ${limite} MB`
        : `${usado} de ${limite}`;

    const enviado = await enviarAviso(organization, kind, {
      subject: estourou
        ? `Limite de ${rotulo} atingido no Pauta`
        : `Você já usou ${Math.round(proporcao * 100)}% do limite de ${rotulo}`,
      title: estourou ? `Limite de ${rotulo} atingido` : `Limite de ${rotulo} chegando ao fim`,
      paragraphs: [
        `A conta <strong>${nome}</strong> está usando <strong>${quantidade}</strong> de ${rotulo} no plano ${billing.planName}.`,
        estourou
          ? "Enquanto estiver no limite, não é possível criar mais itens desse tipo. Nada foi apagado: dá para liberar espaço removendo itens ou escolher um plano maior."
          : "Vale conferir se o plano atual ainda atende o time. Dá para contratar adicionais ou mudar de plano quando quiser.",
      ],
      buttonLabel: "Ver planos e limites",
    });
    if (enviado) enviados.push(kind);
  }

  // 3. Fatura em aberto: aviso e bloqueio.
  if (billing.payment.pastDue) {
    const dias = billing.payment.days;

    if (dias >= PAYMENT_READ_ONLY_DAYS) {
      const enviado = await enviarAviso(organization, "fatura_bloqueio", {
        subject: "Conta em somente leitura por fatura em aberto",
        title: "Sua conta está somente leitura",
        paragraphs: [
          `A fatura da conta <strong>${nome}</strong> está em aberto há ${dias} dias, então a conta entrou em somente leitura.`,
          "Vocês continuam vendo e baixando tudo. Assim que o pagamento for confirmado, a edição volta automaticamente.",
        ],
        buttonLabel: "Atualizar pagamento",
      });
      if (enviado) enviados.push("fatura_bloqueio");
    } else if (dias >= PAYMENT_WARNING_DAYS) {
      const enviado = await enviarAviso(organization, "fatura_atrasada", {
        subject: "Não conseguimos cobrar sua assinatura do Pauta",
        title: "Fatura em aberto",
        paragraphs: [
          `Tentamos cobrar a assinatura da conta <strong>${nome}</strong> e não conseguimos há ${dias} dias.`,
          `Se o pagamento não entrar até o ${PAYMENT_READ_ONLY_DAYS}º dia, a conta fica somente leitura — ninguém perde nada, mas a equipe deixa de criar e editar.`,
          "Atualizar o cartão leva menos de um minuto.",
        ],
        buttonLabel: "Atualizar pagamento",
      });
      if (enviado) enviados.push("fatura_atrasada");
    }
  }

  return enviados;
}

/** Passa por todas as contas e envia o que for necessário. */
async function runBillingNotices() {
  await ensureBillingNoticeSchema();

  const result = await postgres.query(
    "SELECT * FROM organizations WHERE billing_exempt = FALSE ORDER BY created_at",
  );

  let total = 0;
  for (const organization of result.rows) {
    try {
      const enviados = await avaliarConta(organization);
      total += enviados.length;
      if (enviados.length > 0) {
        console.log(`[avisos] ${organization.name}: ${enviados.join(", ")}`);
      }
    } catch (error) {
      console.error(
        `[avisos] falha ao avaliar ${organization.name}:`,
        error?.message || error,
      );
    }
  }

  return total;
}

function startBillingNoticesWorker() {
  const run = () =>
    runBillingNotices().catch((error) =>
      console.error("[avisos] falha geral", error?.message || error),
    );

  // Um pouco depois da subida, para não competir com as migrações.
  setTimeout(run, 60 * 1000).unref?.();
  const timer = setInterval(run, INTERVALO_WORKER_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  ensureBillingNoticeSchema,
  avaliarConta,
  runBillingNotices,
  startBillingNoticesWorker,
};

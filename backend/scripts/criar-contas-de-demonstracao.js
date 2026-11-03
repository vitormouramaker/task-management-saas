/**
 * Contas fictícias para rodar o Pauta localmente:
 *
 *   - dono@demo.pauta.test     titular da "Empresa Demo" (conta interna,
 *                               sem cobrança e com todos os recursos), com o projeto de exemplo
 *   - membro@demo.pauta.test   membro da mesma empresa, com acesso ao workspace
 *   - pessoal@demo.pauta.test  conta pessoal no plano Grátis
 *   - admin@demo.pauta.test    equipe da plataforma (painel de super-admin)
 *
 * Pode rodar de novo: quem já existe só tem a senha redefinida.
 *
 *   npm run seed:demo                         senha padrão Demo@1234
 *   CONTAS_SENHA="OutraSenha@1" npm run seed:demo
 *
 * Trava de segurança: não roda com NODE_ENV=production.
 */
require("../src/config/env");

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { postgres } = require("../src/server/connect");
const { runStartupMigrations } = require("../src/services/migrations.service");
const { recordAcceptance } = require("../src/services/legal.service");
const { createInitialWorkspace, createOrganizationForMember } = require("../src/services/tenancy.service");

const DOMINIO = "demo.pauta.test";

function digito(base, pesos) {
  const resto = base.reduce((total, valor, i) => total + valor * pesos[i], 0) % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** CPF/CNPJ com dígitos verificadores válidos, derivados de uma semente fixa. */
function cpfDe(semente) {
  const nove = String(100000000 + semente * 7919).slice(-9).split("").map(Number);
  const d1 = digito(nove, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito([...nove, d1], [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...nove, d1, d2].join("");
}

function cnpjDe(semente) {
  const doze = [...String(10000000 + semente * 104729).slice(-8).split("").map(Number), 0, 0, 0, 1];
  const d1 = digito(doze, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito([...doze, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...doze, d1, d2].join("");
}

const PESSOAS = {
  dono: { email: `dono@${DOMINIO}`, name: "Dona Demo", cpf: cpfDe(1), role: "Gerente de Projetos" },
  membro: { email: `membro@${DOMINIO}`, name: "Membro Demo", cpf: cpfDe(2), role: "Analista" },
  pessoal: { email: `pessoal@${DOMINIO}`, name: "Pessoa Demo", cpf: cpfDe(3), role: null },
  admin: { email: `admin@${DOMINIO}`, name: "Equipe Pauta (demo)", cpf: cpfDe(4), role: null },
};

async function garantirPessoa(client, pessoa, hash) {
  const existente = await client.query("SELECT * FROM members WHERE lower(email) = lower($1)", [pessoa.email]);
  if (existente.rows.length > 0) {
    await client.query("UPDATE members SET password_hash = $2 WHERE id = $1", [existente.rows[0].id, hash]);
    return { member: existente.rows[0], nova: false };
  }

  const { rows } = await client.query(
    `
      INSERT INTO members (id, name, email, role, password_hash, avatar_color, cpf, phone, birth_date, email_verified_at)
      VALUES ($1, $2, $3, $4, $5, 'bg-blue-600', $6, '11987650000', '1990-01-15', CURRENT_TIMESTAMP)
      RETURNING *
    `,
    [`user_${crypto.randomBytes(8).toString("hex")}`, pessoa.name, pessoa.email, pessoa.role, hash, pessoa.cpf],
  );
  await recordAcceptance(rows[0].id, { db: client });
  return { member: rows[0], nova: true };
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Este roteiro cria contas com senha conhecida e não roda em produção.");
  }

  const senha = String(process.env.CONTAS_SENHA || "").trim() || "Demo@1234";
  const hash = await bcrypt.hash(senha, 10);

  // Mesmas tabelas e colunas que a API garante ao subir.
  await runStartupMigrations();

  const client = await postgres.connect();
  try {
    await client.query("BEGIN");

    // ---------- Empresa Demo: titular + membro ----------
    const dono = await garantirPessoa(client, PESSOAS.dono, hash);
    if (dono.nova) {
      const empresa = await createOrganizationForMember(client, dono.member, "Empresa Demo");
      await client.query(
        `
          UPDATE organizations
          SET account_type = 'business',
              legal_name = 'EMPRESA DEMO LTDA (FICTICIA)',
              cnpj = $2,
              cnpj_verification_status = 'verified',
              cnpj_registration_status = 'ATIVA (demonstracao)',
              cnpj_checked_at = CURRENT_TIMESTAMP,
              plan = 'profissional',
              subscription_status = 'internal',
              billing_exempt = TRUE,
              onboarding_completed_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [empresa.id, cnpjDe(1)],
      );
      const { workspaceId } = await createInitialWorkspace(client, empresa.id, dono.member.id);
      await client.query("UPDATE workspaces SET name = 'Time de Produto' WHERE id = $1", [workspaceId]);

      const membro = await garantirPessoa(client, PESSOAS.membro, hash);
      await client.query(
        `
          INSERT INTO organization_members (organization_id, member_id, role, status)
          VALUES ($1, $2, 'member', 'active')
          ON CONFLICT (organization_id, member_id) DO UPDATE SET role = 'member', status = 'active'
        `,
        [empresa.id, membro.member.id],
      );
      await client.query("UPDATE members SET active_organization_id = $1 WHERE id = $2", [empresa.id, membro.member.id]);
      await client.query(
        `
          INSERT INTO workspace_members (workspace_id, member_id, permission_level)
          VALUES ($1, $2, 'Edição total')
          ON CONFLICT (workspace_id, member_id) DO NOTHING
        `,
        [workspaceId, membro.member.id],
      );
    } else {
      await garantirPessoa(client, PESSOAS.membro, hash);
    }

    // ---------- Conta pessoal no plano Grátis ----------
    const pessoal = await garantirPessoa(client, PESSOAS.pessoal, hash);
    if (pessoal.nova) {
      const conta = await createOrganizationForMember(client, pessoal.member, PESSOAS.pessoal.name);
      await client.query(
        "UPDATE organizations SET account_type = 'personal', onboarding_completed_at = CURRENT_TIMESTAMP WHERE id = $1",
        [conta.id],
      );
      await createInitialWorkspace(client, conta.id, pessoal.member.id);
    }

    // ---------- Equipe da plataforma (super-admin) ----------
    const admin = await garantirPessoa(client, PESSOAS.admin, hash);
    if (admin.nova) {
      const conta = await createOrganizationForMember(client, admin.member, "Equipe Pauta (demo)");
      await client.query(
        `
          UPDATE organizations
          SET account_type = 'personal', billing_exempt = TRUE, subscription_status = 'internal',
              onboarding_completed_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [conta.id],
      );
    }
    await client.query("UPDATE members SET is_platform_admin = TRUE WHERE id = $1", [admin.member.id]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  for (const pessoa of Object.values(PESSOAS)) console.log(`conta pronta: ${pessoa.email}`);
  console.log(`senha das contas: ${senha}`);
}

main()
  .catch((error) => {
    console.error("Erro ao criar as contas de demonstração:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => postgres.end());

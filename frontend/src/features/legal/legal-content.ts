/**
 * Conteúdo fictício de demonstração.
 *
 * Textos jurídicos de exemplo do Pauta. NÃO são termos reais nem servem como
 * modelo jurídico: existem só para a tela de aceite, a página pública e o
 * versionamento do aceite funcionarem nesta versão de portfólio.
 *
 * Ao mudar qualquer documento, atualize LEGAL_VERSION aqui e em
 * backend/src/services/legal.service.js: a versão nova faz a plataforma pedir
 * um novo aceite.
 */
export const LEGAL_VERSION = "2026-10-13";
export const LEGAL_UPDATED_AT = "13 de outubro de 2026";

export const COMPANY = {
  brand: "Pauta",
  legalName: "Empresa Demonstração Ltda. (fictícia)",
  cnpj: "00.000.000/0001-00",
  supportEmail: "contato@example.com",
  privacyEmail: "privacidade@example.com",
  site: "http://localhost:5173",
};

export interface LegalSection {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  id: "terms" | "privacy" | "cookies";
  title: string;
  summary: string;
  sections: LegalSection[];
}

export const TERMS: LegalDocument = {
  id: "terms",
  title: "Termos de Uso",
  summary:
    "Conteúdo fictício de demonstração. Resume, em linguagem simples, como a plataforma de exemplo funciona.",
  sections: [
    {
      title: "1. Sobre este documento",
      paragraphs: [
        "Conteúdo fictício de demonstração. Este texto acompanha uma versão de portfólio do Pauta e não tem valor jurídico.",
        `A plataforma é mantida, nesta demonstração, pela ${COMPANY.legalName}. Nenhuma empresa real é representada aqui.`,
      ],
    },
    {
      title: "2. O serviço",
      paragraphs: [
        "O Pauta organiza o trabalho de equipes em espaços de trabalho, projetos e cards, com comentários, anexos, etiquetas, e-mail interno e notificações.",
      ],
    },
    {
      title: "3. Conta e acesso",
      bullets: [
        "Cada pessoa usa o próprio login. Quem administra uma conta pode convidar, remover e definir permissões.",
        "Dados de cadastro desta demonstração devem ser fictícios.",
      ],
    },
    {
      title: "4. Planos e cobrança",
      paragraphs: [
        "Há um plano gratuito e planos pagos de exemplo, com valores fictícios mostrados na tela de Assinatura. A cobrança usa a Stripe em modo de teste quando ela está configurada.",
        "Reduções de plano valem no fim do período pago; aumentos são cobrados de forma proporcional e liberados quando o pagamento é confirmado.",
      ],
    },
    {
      title: "5. Teste, atraso e cancelamento",
      bullets: [
        "Contas novas podem ativar um teste do plano Profissional, uma vez por CPF/CNPJ e por e-mail.",
        "Com pagamento em atraso, a plataforma avisa e, depois de alguns dias, deixa a conta em somente leitura.",
        "Depois do cancelamento, os arquivos ficam guardados por um período e então são removidos, com aviso por e-mail.",
      ],
    },
    {
      title: "6. Lixeira e limites",
      paragraphs: [
        "Itens apagados vão para a Lixeira e podem ser restaurados dentro do prazo do plano. Ao atingir um limite do plano, só a criação de novos itens é bloqueada: nada é apagado.",
      ],
    },
    {
      title: "7. Contato",
      paragraphs: [`Dúvidas sobre esta demonstração: ${COMPANY.supportEmail}.`],
    },
  ],
};

export const PRIVACY: LegalDocument = {
  id: "privacy",
  title: "Política de Privacidade",
  summary:
    "Conteúdo fictício de demonstração. Descreve, de forma resumida, quais dados a plataforma de exemplo guarda e por quê.",
  sections: [
    {
      title: "1. Sobre este documento",
      paragraphs: [
        "Conteúdo fictício de demonstração, sem valor jurídico. Rodando localmente, todos os dados ficam apenas no seu banco de dados.",
      ],
    },
    {
      title: "2. Dados tratados",
      bullets: [
        "Cadastro: nome, e-mail, senha (apenas o hash), CPF ou CNPJ, telefone, cargo e foto.",
        "Conteúdo: espaços de trabalho, projetos, cards, comentários, arquivos e mensagens internas.",
        "Segurança: IP, navegador, sessões abertas e registros de ações relevantes.",
      ],
    },
    {
      title: "3. Serviços de terceiros (opcionais)",
      bullets: [
        "Stripe: pagamentos.",
        "Bunny.net: armazenamento de arquivos (localmente, uma pasta do disco).",
        "Firebase Cloud Messaging: notificações push, quando autorizadas.",
        "Servidor SMTP: e-mails transacionais (localmente, impressos no console).",
      ],
    },
    {
      title: "4. Seus direitos",
      paragraphs: [
        "Em Configurações > Privacidade é possível baixar os próprios dados, excluir um espaço de trabalho e excluir o cadastro.",
        `Contato de privacidade desta demonstração: ${COMPANY.privacyEmail}.`,
      ],
    },
    {
      title: "5. Cookies",
      paragraphs: [
        "A plataforma usa armazenamento local apenas para manter a sessão e lembrar preferências, como tema e filtros.",
      ],
    },
  ],
};

export const COOKIES_NOTICE = {
  title: "Este site usa cookies",
  message:
    "Usamos cookies e armazenamento local apenas para manter você conectado, lembrar suas preferências e proteger sua conta. Não usamos cookies de publicidade.",
  acceptLabel: "Entendi",
  detailsLabel: "Ver política",
};

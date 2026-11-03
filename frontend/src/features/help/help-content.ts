/**
 * Conteúdo fictício de demonstração.
 *
 * Central de ajuda de exemplo do Pauta. Mudar aqui muda a tela de ajuda e a
 * busca dela (que procura na pergunta, na resposta e nas palavras-chave).
 */
export interface HelpArticle {
  id: string;
  question: string;
  answer: string[];
  keywords?: string[];
}

export interface HelpSection {
  id: string;
  title: string;
  articles: HelpArticle[];
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "comecando",
    title: "Primeiros passos",
    articles: [
      {
        id: "primeiros-passos",
        question: "Por onde começo?",
        answer: [
          "Conteúdo fictício de demonstração.",
          "Cada conta nova já vem com um projeto de boas-vindas com alguns cards de exemplo. Abra um deles para ver checklist, comentários e anexos.",
          "O tour de apresentação pode ser aberto de novo pelo menu Suporte.",
        ],
        keywords: ["tour", "exemplo", "início", "onboarding"],
      },
      {
        id: "workspace-projeto-card",
        question: "Workspace, projeto e card: o que é cada um?",
        answer: [
          "O workspace agrupa projetos de um time ou cliente e define quem tem acesso.",
          "O projeto é um quadro com colunas de status. O card é a tarefa em si.",
        ],
        keywords: ["estrutura", "organização", "quadro", "lista"],
      },
      {
        id: "convidar-equipe",
        question: "Como chamo outras pessoas?",
        answer: [
          "Em Membros, envie um convite por e-mail. Convites pendentes já contam como vaga do plano.",
          "A permissão (ver, comentar ou editar) é definida por workspace.",
        ],
        keywords: ["convite", "membros", "equipe", "permissão", "vagas"],
      },
    ],
  },
  {
    id: "dia-a-dia",
    title: "Uso diário",
    articles: [
      {
        id: "visoes",
        question: "Quais visões de projeto existem?",
        answer: [
          "Quadro, Lista, Tabela, Timeline e Calendário. As visões liberadas dependem do plano.",
          "Na Timeline e no Calendário, arrastar o card muda as datas.",
        ],
        keywords: ["lista", "tabela", "timeline", "calendário", "visão", "gantt"],
      },
      {
        id: "automacoes",
        question: "Dá para automatizar tarefas repetitivas?",
        answer: [
          "Sim. Em Configurações > Automações, crie regras de gatilho e ação, como avisar alguém quando um card muda de coluna ou quando o prazo está perto.",
        ],
        keywords: ["automação", "regra", "gatilho", "robô"],
      },
      {
        id: "arquivos",
        question: "Como funcionam os anexos?",
        answer: [
          "Arraste arquivos para o card ou use o botão de anexo. Os anexos de um card podem ser baixados juntos em ZIP.",
          "Tamanho por arquivo e armazenamento total seguem o plano.",
        ],
        keywords: ["anexo", "arquivo", "upload", "armazenamento", "zip"],
      },
      {
        id: "lixeira",
        question: "Apaguei algo por engano. E agora?",
        answer: [
          "Itens apagados ficam na Lixeira, no menu lateral, e podem ser restaurados dentro do prazo do plano.",
        ],
        keywords: ["lixeira", "apagar", "restaurar", "recuperar", "excluído"],
      },
    ],
  },
  {
    id: "conta",
    title: "Plano e pagamento",
    articles: [
      {
        id: "trocar-plano",
        question: "Como troco de plano?",
        answer: [
          "Em Configurações > Assinatura. Subir de plano é cobrado proporcionalmente; descer passa a valer no fim do período pago.",
        ],
        keywords: ["plano", "upgrade", "downgrade", "assinatura", "mudar"],
      },
      {
        id: "cancelar",
        question: "Como cancelo?",
        answer: [
          "Também em Configurações > Assinatura. O plano continua até o fim do período pago e pode ser reativado antes disso.",
        ],
        keywords: ["cancelar", "cancelamento", "assinatura", "encerrar"],
      },
      {
        id: "falta-pagamento",
        question: "E se o pagamento falhar?",
        answer: [
          "A plataforma avisa por e-mail e na tela. Depois de alguns dias em atraso, a conta fica em somente leitura até o pagamento ser regularizado.",
        ],
        keywords: ["pagamento", "atraso", "bloqueio", "somente leitura", "fatura"],
      },
    ],
  },
  {
    id: "seguranca",
    title: "Segurança e privacidade",
    articles: [
      {
        id: "quem-ve",
        question: "Quem vê o que eu crio?",
        answer: [
          "Workspaces e projetos podem ser públicos para a conta, privados ou restritos a administradores. Um card herda a visibilidade do projeto.",
        ],
        keywords: ["privacidade", "visibilidade", "permissão", "privado", "acesso"],
      },
      {
        id: "meus-dados",
        question: "Como exporto ou apago meus dados?",
        answer: [
          "Em Configurações, na parte de Privacidade, há a exportação dos seus dados e a exclusão do workspace ou do cadastro.",
        ],
        keywords: ["lgpd", "dados", "exportar", "excluir conta", "privacidade"],
      },
      {
        id: "senha",
        question: "Como troco a senha ou encerro outras sessões?",
        answer: [
          "Em Configurações você troca a senha, vê as sessões abertas e pode sair de todos os aparelhos.",
        ],
        keywords: ["senha", "sessão", "sair", "segurança", "dispositivo"],
      },
    ],
  },
];

export const HELP_CONTACT = {
  chatHint: "Não encontrou a resposta? Abra o menu Suporte e fale com a equipe.",
};

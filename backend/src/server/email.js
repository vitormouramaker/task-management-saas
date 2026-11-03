const nodemailer = require('nodemailer');

// Sem SMTP_HOST nenhum e-mail sai da máquina: destinatário, assunto e links
// são impressos no console (é assim que se testa localmente o fluxo de
// confirmação de e-mail, convite e recuperação de senha).
const smtpTransporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 465,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

const transporter = {
  async sendMail(message) {
    if (smtpTransporter) return smtpTransporter.sendMail(message);
    if (process.env.NODE_ENV === 'production') {
      // Em produção, nunca imprimir links com token no log.
      throw new Error('SMTP_HOST não configurado.');
    }
    const links = [...String(message.html || '').matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    console.log(`[e-mail local] para: ${message.to} | assunto: ${message.subject}`);
    for (const link of new Set(links)) console.log(`[e-mail local]   link: ${link}`);
    return { messageId: 'local-' + Date.now() };
  },
};

function getFrontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Layout único dos e-mails transacionais. Textos já devem vir escapados.
function renderEmailLayout({ title, paragraphs, buttonLabel, buttonUrl, footer }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
      <h2 style="color: #2563eb;">${title}</h2>
      ${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('')}
      <a href="${buttonUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 10px;">
        ${buttonLabel}
      </a>
      <p style="margin-top: 20px; font-size: 13px; color: #64748b;">
        Se o botão não funcionar, copie e cole este endereço no navegador:<br />
        <span style="word-break: break-all;">${buttonUrl}</span>
      </p>
      <p style="margin-top: 12px; font-size: 13px; color: #64748b;">${footer}</p>
    </div>
  `;
}

async function sendMail({ to, subject, html }) {
  try {
    const info = await transporter.sendMail({
      from: `"Pauta" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error?.message || error);
    return false;
  }
}

const sendResetPasswordEmail = async (toEmail, resetToken) => {
  const frontendUrl = getFrontendUrl();
  const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
      <h2 style="color: #2563eb;">Recuperação de Senha - Pauta</h2>
      <p>Você solicitou a redefinição de sua senha na plataforma Pauta.</p>
      <p>Para criar uma nova senha, clique no botão abaixo:</p>
      <a href="${resetLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; margin-top: 10px;">
        Redefinir minha senha
      </a>
      <p style="margin-top: 20px; font-size: 13px; color: #64748b;">
        Se você não solicitou esta alteração, pode ignorar este e-mail de forma segura. O link irá expirar em 1 hora.
      </p>
    </div>
  `;

  try {
    const info = await transporter.sendMail({
      from: `"Pauta" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: 'Recuperação de Senha',
      html: htmlContent,
    });
    console.log('Message sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    return false;
  }
};

function sendVerificationEmail({ to, name, token }) {
  const link = `${getFrontendUrl()}/verificar-email?token=${encodeURIComponent(token)}`;

  return sendMail({
    to,
    subject: 'Confirme seu e-mail - Pauta',
    html: renderEmailLayout({
      title: 'Confirme seu e-mail',
      paragraphs: [
        `Olá, ${escapeHtml(name || '')}!`,
        'Falta só um passo para começar a usar o Pauta: confirme que este e-mail é seu.',
      ],
      buttonLabel: 'Confirmar meu e-mail',
      buttonUrl: link,
      footer: 'O link expira em 3 dias. Se você não criou uma conta no Pauta, ignore este e-mail.',
    }),
  });
}

function sendInvitationEmail({ to, organizationName, inviterName, accessRole, token }) {
  const link = `${getFrontendUrl()}/convite?token=${encodeURIComponent(token)}`;
  const roleLabel = accessRole === 'admin' ? 'administrador(a)' : 'membro';

  return sendMail({
    to,
    subject: `Convite para ${organizationName} no Pauta`,
    html: renderEmailLayout({
      title: `Você foi convidado(a) para ${escapeHtml(organizationName)}`,
      paragraphs: [
        `${escapeHtml(inviterName || 'Um administrador')} convidou você para participar de <strong>${escapeHtml(organizationName)}</strong> no Pauta como ${roleLabel}.`,
        'Se você já tem conta no Pauta, basta entrar com este e-mail. Se ainda não tem, você cria sua senha em poucos segundos.',
      ],
      buttonLabel: 'Aceitar convite',
      buttonUrl: link,
      footer: 'O convite expira em 7 dias. Se você não esperava este convite, ignore este e-mail.',
    }),
  });
}

/**
 * Avisos de plano e cobrança (fim do teste, limite chegando, fatura em aberto).
 * O texto vem pronto de quem chama; aqui só entra o layout.
 */
const sendPlanNoticeEmail = async ({ to, name, subject, title, paragraphs, buttonLabel }) => {
  const frontendUrl = getFrontendUrl();
  const saudacao = name ? `Olá, ${escapeHtml(String(name).split(' ')[0])}!` : 'Olá!';

  const html = renderEmailLayout({
    title: escapeHtml(title),
    paragraphs: [saudacao, ...paragraphs],
    buttonLabel: escapeHtml(buttonLabel || 'Abrir o Pauta'),
    buttonUrl: `${frontendUrl}/?billing=plans`,
    footer:
      'Você recebe este aviso porque administra esta conta no Pauta. ' +
      'Para mudar de plano ou cancelar, entre em Configurações &gt; Assinatura.',
  });

  return sendMail({ to, subject, html });
};

/** Avisa a equipe do Pauta que chegou uma solicitação de plano Enterprise. */
const sendEnterpriseRequestEmail = async (request) => {
  const destino = process.env.ENTERPRISE_REQUESTS_EMAIL || 'contato@example.com';
  const linha = (rotulo, valor) =>
    `<strong>${rotulo}:</strong> ${escapeHtml(valor === null || valor === undefined || valor === '' ? '—' : valor)}`;

  const html = renderEmailLayout({
    title: 'Nova solicitação de plano Enterprise',
    paragraphs: [
      linha('Conta', request.organizationName),
      linha('Empresa', request.companyName),
      linha('Contato', `${request.contactName} <${request.contactEmail}>`),
      linha('Telefone', request.contactPhone),
      linha('Tamanho da equipe', request.teamSize),
      linha('Pessoas necessárias', request.seatsNeeded),
      linha('Armazenamento necessário (GB)', request.storageNeededGb),
      linha('Por que quer o Enterprise', request.reason),
    ],
    buttonLabel: 'Abrir o painel de solicitações',
    buttonUrl: `${getFrontendUrl()}/admin/enterprise`,
    footer: 'Mensagem automática do Pauta.',
  });

  return sendMail({ to: destino, subject: `Solicitação Enterprise: ${request.companyName || request.organizationName}`, html });
};

/** E-mails do chat de suporte (para a equipe ou para o cliente). */
const sendSupportEmail = async ({ to, subject, title, paragraphs, buttonLabel, path, url, footer }) => {
  const html = renderEmailLayout({
    title: escapeHtml(title),
    paragraphs,
    buttonLabel: escapeHtml(buttonLabel || 'Abrir o Pauta'),
    buttonUrl: url || `${getFrontendUrl()}${path || '/'}`,
    footer: footer || 'Mensagem automática do Pauta.',
  });

  return sendMail({ to, subject, html });
};

module.exports = {
  sendEnterpriseRequestEmail,
  sendSupportEmail,
  sendPlanNoticeEmail,
  sendResetPasswordEmail,
  sendVerificationEmail,
  sendInvitationEmail,
};

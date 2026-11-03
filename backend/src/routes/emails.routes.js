const express = require('express');
const router = express.Router();
const { postgres } = require('../server/connect');
const { verifyToken } = require('../middlewares/auth.middleware');
const fs = require('fs');
const path = require('path');
const { extractStoragePathFromUrl } = require('../services/bunny.service');
const {
  ORGANIZATION_COMMON_FOLDERS,
  assertEmailAttachmentsAllowed,
  receiveUpload,
  resolveOrganizationFolderPath,
  sendStorageError,
} = require('../services/storage.service');
const { publishRealtimeEvent } = require('../services/realtime.service');

/** Tabela e colunas do e-mail interno, garantidas no arranque do servidor. */
async function ensureSentEmailsSchema() {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS sent_emails (
      id          VARCHAR(100) PRIMARY KEY,
      sender_id   VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
      to_email    VARCHAR(255) NOT NULL,
      subject     VARCHAR(255) NOT NULL,
      subtitle    VARCHAR(255),
      body        TEXT NOT NULL,
      attachments TEXT[] DEFAULT '{}',
      read        BOOLEAN DEFAULT FALSE,
      sent_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await postgres.query(`
    ALTER TABLE sent_emails
    ADD COLUMN IF NOT EXISTS link_display_modes JSONB DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS recipient_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'sent'
  `);
}

const ensureSentEmailsLinkDisplayModesSchema = ensureSentEmailsSchema;

function serializeEmailRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    to: row.to_email,
    subject: row.subject,
    subtitle: row.subtitle,
    body: row.body,
    attachments: row.attachments || [],
    read: row.read,
    type: row.type,
    senderName: row.sender_name,
    senderEmail: row.sender_email,
    senderAvatarColor: row.sender_avatar_color,
    senderAvatarUrl: row.sender_avatar_url,
    sentAt: row.sent_at,
    linkDisplayModes: row.link_display_modes || {},
  };
}

// Listar e-mails enviados e recebidos pelo usuário logado
router.get('/', verifyToken, async (req, res) => {
  const userId = req.user.id;
  try {
    await ensureSentEmailsSchema();
    const result = await postgres.query(
      `SELECT e.*,
              m.name         AS sender_name,
              m.email        AS sender_email,
              m.avatar_color AS sender_avatar_color,
              m.avatar_url   AS sender_avatar_url
       FROM sent_emails e
       LEFT JOIN members m ON e.sender_id = m.id
       WHERE (e.sender_id = $1 AND e.type = 'sent')
          OR (e.recipient_id = $1 AND e.type = 'received')
       ORDER BY e.sent_at DESC LIMIT 100`,
      [userId]
    );
    const emails = result.rows.map(serializeEmailRow);
    res.json(emails);
  } catch (error) {
    console.error('Erro ao buscar e-mails:', error);
    res.status(500).json({ message: 'Erro ao buscar e-mails.' });
  }
});

// Enviar novo e-mail (aceita vários destinatários separados por vírgula)
router.post('/', verifyToken, async (req, res) => {
  const senderId = req.user.id;
  const { to, subject, subtitle, body, attachments, linkDisplayModes } = req.body;
  // Só aceita anexos hospedados na nossa Bunny.
  const safeAttachments = Array.isArray(attachments)
    ? attachments.filter((url) => typeof url === 'string' && extractStoragePathFromUrl(url))
    : [];

  // "a@x.com, b@x.com; c@x.com" vira uma lista limpa e sem repetidos.
  const destinatarios = [
    ...new Set(
      String(to || '')
        .split(/[,;]/)
        .map((endereco) => endereco.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];

  if (destinatarios.length === 0 || !subject || !body) {
    return res.status(400).json({ message: 'Destinatário, assunto e corpo são obrigatórios.' });
  }

  if (destinatarios.length > 20) {
    return res.status(400).json({ message: 'Envie para no máximo 20 pessoas por vez.' });
  }

  const enderecoInvalido = destinatarios.find(
    (endereco) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(endereco),
  );
  if (enderecoInvalido) {
    return res.status(400).json({ message: `E-mail inválido: ${enderecoInvalido}` });
  }

  try {
    await assertEmailAttachmentsAllowed({
      organizationId: req.user.organizationId,
      urls: safeAttachments,
    });
  } catch (error) {
    return sendStorageError(req, res, error, 'Erro ao validar os anexos.');
  }

  const criarId = () => 'em_' + Math.random().toString(36).slice(2, 12);
  const listaExibida = destinatarios.join(', ');

  async function carregarEmail(id) {
    const resultado = await postgres.query(
      `SELECT e.*, m.name AS sender_name, m.email AS sender_email, m.avatar_color AS sender_avatar_color, m.avatar_url AS sender_avatar_url
       FROM sent_emails e LEFT JOIN members m ON e.sender_id = m.id
       WHERE e.id = $1`,
      [id],
    );
    return serializeEmailRow(resultado.rows[0]);
  }

  try {
    // Quem são desses endereços é membro da plataforma.
    const membros = await postgres.query(
      'SELECT id, lower(email) AS email FROM members WHERE lower(email) = ANY($1::text[])',
      [destinatarios],
    );
    const idPorEmail = new Map(membros.rows.map((row) => [row.email, row.id]));

    // Uma cópia "enviada" para o remetente, com todos os destinatários.
    const sentId = criarId();
    await postgres.query(
      `INSERT INTO sent_emails (id, sender_id, recipient_id, to_email, subject, subtitle, body, attachments, link_display_modes, read, type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, 'sent')`,
      [
        sentId,
        senderId,
        idPorEmail.get(destinatarios[0]) || null,
        listaExibida,
        subject,
        subtitle || null,
        body,
        safeAttachments,
        linkDisplayModes || {},
      ],
    );

    const sentEmail = await carregarEmail(sentId);
    if (sentEmail) {
      publishRealtimeEvent({
        type: 'email.upsert',
        actorId: senderId,
        userIds: [senderId],
        payload: { email: sentEmail },
      });
    }

    // Uma cópia "recebida" para cada destinatário interno.
    for (const endereco of destinatarios) {
      const recipientId = idPorEmail.get(endereco);
      if (!recipientId) continue;

      const receivedId = criarId();
      await postgres.query(
        `INSERT INTO sent_emails (id, sender_id, recipient_id, to_email, subject, subtitle, body, attachments, link_display_modes, read, type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, 'received')`,
        [
          receivedId,
          senderId,
          recipientId,
          listaExibida,
          subject,
          subtitle || null,
          body,
          safeAttachments,
          linkDisplayModes || {},
        ],
      );

      const receivedEmail = await carregarEmail(receivedId);
      if (receivedEmail) {
        publishRealtimeEvent({
          type: 'email.upsert',
          actorId: senderId,
          userIds: [recipientId],
          payload: { email: receivedEmail },
        });
      }
    }

    res.status(201).json(sentEmail);
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    res.status(500).json({ message: 'Erro ao enviar e-mail.' });
  }
});

// Marcar e-mail como lido
router.patch('/:id/read', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const emailId = req.params.id;
  try {
    const result = await postgres.query(
      'UPDATE sent_emails SET read = TRUE WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2) RETURNING id',
      [emailId, userId]
    );
    if (result.rows.length > 0) {
      publishRealtimeEvent({
        type: 'email.read',
        actorId: userId,
        userIds: [userId],
        payload: { id: emailId },
      });
    }
    res.json({ message: 'E-mail marcado como lido.' });
  } catch (error) {
    console.error('Erro ao marcar e-mail como lido:', error);
    res.status(500).json({ message: 'Erro ao marcar e-mail como lido.' });
  }
});

router.patch('/:id/link-display-modes', verifyToken, async (req, res) => {
  const userId = req.user.id;
  const emailId = req.params.id;
  const { linkDisplayModes } = req.body;

  try {
    await ensureSentEmailsLinkDisplayModesSchema();
    const updateResult = await postgres.query(
      `UPDATE sent_emails
       SET link_display_modes = $1
       WHERE id = $2 AND (sender_id = $3 OR recipient_id = $3)
       RETURNING sender_id, recipient_id`,
      [linkDisplayModes || {}, emailId, userId]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: 'E-mail não encontrado.' });
    }

    const emailResult = await postgres.query(
      `SELECT e.*, m.name AS sender_name, m.email AS sender_email, m.avatar_color AS sender_avatar_color, m.avatar_url AS sender_avatar_url
       FROM sent_emails e LEFT JOIN members m ON e.sender_id = m.id
       WHERE e.id = $1`,
      [emailId]
    );
    const updatedEmail = serializeEmailRow(emailResult.rows[0]);

    if (updatedEmail) {
      publishRealtimeEvent({
        type: 'email.upsert',
        actorId: userId,
        userIds: [updateResult.rows[0].sender_id, updateResult.rows[0].recipient_id].filter(Boolean),
        payload: { email: updatedEmail },
      });
    }

    res.json(updatedEmail);
  } catch (error) {
    console.error('Erro ao atualizar visualização de link do e-mail:', error);
    res.status(500).json({ message: 'Erro ao atualizar visualização de link do e-mail.' });
  }
});

// Envio antigo em base64, substituído por POST /attachments/upload.
router.post('/attachments', verifyToken, (_req, res) => {
  res.status(410).json({
    message: 'O envio de arquivos foi atualizado. Recarregue a página e tente novamente.',
  });
});

// Upload de anexo de e-mail: corpo binário + headers X-File-Name e X-File-Type.
// O arquivo vai para Pauta/<empresa>/_emails na Bunny.
router.post('/attachments/upload', verifyToken, async (req, res) => {
  const organizationId = req.user.organizationId;

  try {
    const organizationPath = organizationId
      ? await resolveOrganizationFolderPath(postgres, organizationId)
      : null;
    const file = await receiveUpload(req, {
      organizationId,
      folderPath: `${organizationPath}/${ORGANIZATION_COMMON_FOLDERS.emails}`,
      kind: 'email_attachment',
      uploadedBy: req.user.id,
    });

    res.status(201).json({
      file: {
        url: file.url,
        name: file.name,
        size: file.size,
        contentType: file.contentType,
      },
    });
  } catch (error) {
    sendStorageError(req, res, error, 'Erro ao enviar anexo do e-mail.');
  }
});

router.ensureSentEmailsSchema = ensureSentEmailsSchema;

module.exports = router;

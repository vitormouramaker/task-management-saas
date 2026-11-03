const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { postgres } = require('../server/connect');
const { verifyToken } = require('../middlewares/auth.middleware');
const fs = require('fs');
const path = require('path');
const {
  MAX_AVATAR_BYTES,
  ORGANIZATION_COMMON_FOLDERS,
  StorageError,
  assertUploadAllowed,
  releaseStorageUrls,
  resolveOrganizationFolderPath,
  uploadBufferToStorage,
} = require('../services/storage.service');
const { resolveOrganizationBilling } = require('../services/billing.service');

const { requireOrganizationAdmin } = require('../middlewares/organization-admin.middleware');
const { AccountError } = require('../services/account.service');
const { assertJobTitleAllowed, listJobTitles } = require('../services/job-titles.service');

async function ensureMemberTagSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS member_tags (
      member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
      tag_id VARCHAR(100) REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (member_id, tag_id)
    )
  `);
}

async function getMemberTags(client, memberId) {
  const result = await client.query(
    `
      SELECT t.id, t.name, t.color
      FROM member_tags mt
      INNER JOIN tags t ON t.id = mt.tag_id
      WHERE mt.member_id = $1
      ORDER BY t.name ASC
    `,
    [memberId]
  );

  return result.rows;
}

// Troca as etiquetas da pessoa só dentro da organização informada: etiquetas
// dão acesso a workspaces, então id de etiqueta de outra conta é ignorado, e as
// etiquetas que a pessoa tem em outras contas ficam como estão.
async function replaceMemberTags(client, memberId, tagIds, organizationId) {
  await ensureMemberTagSchema(client);
  if (!organizationId) {
    return;
  }

  await client.query(
    'DELETE FROM member_tags WHERE member_id = $1 AND tag_id IN (SELECT id FROM tags WHERE organization_id = $2)',
    [memberId, organizationId]
  );

  if (!Array.isArray(tagIds) || tagIds.length === 0) {
    return;
  }

  const requestedTagIds = [...new Set(tagIds.filter(Boolean).map(String))];
  const validTags = await client.query(
    'SELECT id FROM tags WHERE organization_id = $1 AND id = ANY($2::text[])',
    [organizationId, requestedTagIds]
  );
  const normalizedTagIds = validTags.rows.map((row) => row.id);
  for (const tagId of normalizedTagIds) {
    await client.query(
      'INSERT INTO member_tags (member_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [memberId, tagId]
    );
  }
}

async function buildUserResponse(client, memberRow) {
  const tags = await getMemberTags(client, memberRow.id);
  return {
    id: memberRow.id,
    name: memberRow.name,
    email: memberRow.email,
    role: memberRow.role,
    avatarColor: memberRow.avatar_color,
    avatarUrl: memberRow.avatar_url || null,
    tags,
    tagIds: tags.map((tag) => tag.id),
  };
}

// Cargos da conta ativa (lista gerenciada em Configurações > Cargos).
router.get("/roles", verifyToken, async (req, res) => {
  try {
    if (!req.user.organizationId) {
      return res.json({ roles: [] });
    }
    const jobTitles = await listJobTitles(req.user.organizationId);
    res.json({ roles: jobTitles.map((jobTitle) => jobTitle.name) });
  } catch (error) {
    console.error('Erro ao listar cargos:', error);
    res.status(500).json({ message: 'Erro ao listar cargos.' });
  }
});

function sendKnownError(res, error) {
  if (error instanceof AccountError) {
    res.status(error.status).json({ message: error.message, field: error.field });
    return true;
  }
  return false;
}

router.post('/', verifyToken, requireOrganizationAdmin, async (req, res) => {
  // role = cargo (texto livre); accessRole = permissão na conta ('admin' | 'member').
  const { name, role, password, tagIds, accessRole } = req.body;
  // E-mail sempre em minúsculas: variações de caixa não podem virar outra conta.
  const email = String(req.body.email || '').trim().toLowerCase();
  const organizationId = req.user.organizationId;

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'Nome, E-mail e Senha sao obrigatorios.' });
  }

  if (!organizationId) {
    return res.status(403).json({
      message: 'Conta sem empresa ativa. Faça login novamente.',
    });
  }

  const client = await postgres.connect();

  try {
    // Validar antes da transação: a lista de cargos pode ser criada na primeira consulta.
    const jobTitle = await assertJobTitleAllowed(organizationId, role);
    await client.query('BEGIN');
    await ensureMemberTagSchema(client);

    const organizationResult = await client.query(
      `
        SELECT plan, subscription_status, trial_ends_at, extra_seats,
               extra_storage_packs, billing_exempt, custom_entitlements
        FROM organizations WHERE id = $1
      `,
      [organizationId]
    );
    const entitlements = resolveOrganizationBilling(organizationResult.rows[0]).entitlements;

    if (entitlements.seats > -1) {
      // Convites pendentes já ocupam vaga: senão dá para estourar o plano
      // criando pessoas direto enquanto os convites esperam resposta.
      const memberCountResult = await client.query(
        `
          SELECT (
            (SELECT COUNT(*) FROM organization_members
             WHERE organization_id = $1 AND status = 'active')
            +
            (SELECT COUNT(*) FROM organization_invitations
             WHERE organization_id = $1 AND status = 'pending' AND expires_at > NOW())
          )::int AS count
        `,
        [organizationId]
      );

      if ((memberCountResult.rows[0]?.count || 0) >= entitlements.seats) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          code: 'PLAN_LIMIT_USERS',
          message: `Seu plano permite ate ${entitlements.seats} pessoas. Adicione usuarios extras ou faça upgrade.`,
        });
      }
    }

    const resultCheck = await client.query('SELECT id FROM members WHERE lower(email) = lower($1)', [email]);
    if (resultCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Ja existe um usuario com esse e-mail.' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const id = 'user_' + crypto.randomBytes(8).toString('hex');
    const avatarColor = 'bg-slate-600';

    const insertResult = await client.query(
      `
        INSERT INTO members (id, name, email, role, password_hash, avatar_color, email_verified_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        RETURNING id, name, email, role, avatar_color, avatar_url
      `,
      [id, name, email, jobTitle, passwordHash, avatarColor]
    );

    await replaceMemberTags(client, id, tagIds, organizationId);
    await client.query(
      `
        INSERT INTO organization_members (organization_id, member_id, role, status)
        VALUES ($1, $2, $3, 'active')
        ON CONFLICT (organization_id, member_id)
        DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status
      `,
      [organizationId, id, accessRole === 'admin' ? 'admin' : 'member']
    );
    const user = await buildUserResponse(client, insertResult.rows[0]);
    await client.query('COMMIT');

    res.status(201).json({
      message: 'Usuario criado com sucesso',
      user,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (sendKnownError(res, error)) return;
    console.error('Erro ao criar usuario:', error);
    res.status(500).json({ message: 'Erro interno ao criar usuario.' });
  } finally {
    client.release();
  }
});

router.put('/profile', verifyToken, async (req, res) => {
  const { name, role, tagIds } = req.body;
  const userId = req.user.id;
  const isAdm = ['owner', 'admin'].includes(req.user?.organizationRole);

  if (!name) {
    return res.status(400).json({ message: 'O nome e obrigatorio.' });
  }

  const client = await postgres.connect();

  try {
    await ensureMemberTagSchema(client);
    const currentMemberResult = await client.query(
      `
        SELECT id, name, email, role, avatar_color, avatar_url
        FROM members
        WHERE id = $1
      `,
      [userId]
    );

    if (currentMemberResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }

    const currentMember = currentMemberResult.rows[0];
    const nextRole = isAdm
      ? await assertJobTitleAllowed(req.user.organizationId, role, { currentValue: currentMember.role })
      : currentMember.role;

    const updateResult = await client.query(
      `
        UPDATE members
        SET name = $1, role = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING id, name, email, role, avatar_color, avatar_url
      `,
      [name, nextRole, userId]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }

    if (isAdm && Array.isArray(tagIds)) {
      await replaceMemberTags(client, userId, tagIds, req.user.organizationId);
    }
    const user = await buildUserResponse(client, updateResult.rows[0]);

    res.json({
      message: 'Perfil atualizado com sucesso.',
      user,
    });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({ message: 'Erro interno ao atualizar perfil.' });
  } finally {
    client.release();
  }
});

router.put('/profile/avatar', verifyToken, async (req, res) => {
  const { avatarColor } = req.body;
  const userId = req.user.id;

  const client = await postgres.connect();

  try {
    await ensureMemberTagSchema(client);
    const updateResult = await client.query(
      `
        UPDATE members
        SET avatar_color = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, name, email, role, avatar_color, avatar_url
      `,
      [avatarColor, userId]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }

    const user = await buildUserResponse(client, updateResult.rows[0]);

    res.json({
      message: 'Avatar atualizado com sucesso.',
      user,
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro interno ao atualizar avatar.' });
  } finally {
    client.release();
  }
});

router.post('/profile/avatar/upload', verifyToken, async (req, res) => {
  const { imageBase64 } = req.body;
  const userId = req.user.id;

  if (!imageBase64) {
    return res.status(400).json({ message: 'Nenhuma imagem fornecida.' });
  }

  try {
    const matches = imageBase64.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ message: 'Formato de imagem invalido. Use PNG, JPG ou WebP.' });
    }

    const imageType = matches[1] === 'jpg' ? 'jpeg' : matches[1];
    const extension = imageType === 'jpeg' ? 'jpg' : imageType;
    const buffer = Buffer.from(matches[2], 'base64');

    if (buffer.length > MAX_AVATAR_BYTES) {
      return res.status(413).json({ message: 'A foto de perfil deve ter no maximo 2 MB.' });
    }

    const organizationId = req.user.organizationId;
    await assertUploadAllowed({ organizationId, sizeBytes: buffer.length });
    const organizationPath = await resolveOrganizationFolderPath(postgres, organizationId);
    // Nome com timestamp: evita a CDN servir a foto antiga do cache.
    const { url: avatarUrl } = await uploadBufferToStorage({
      buffer,
      folderPath: `${organizationPath}/${ORGANIZATION_COMMON_FOLDERS.profiles}`,
      fileName: `${userId}_${Date.now()}.${extension}`,
      organizationId,
      kind: 'avatar',
      originalName: `avatar.${extension}`,
      contentType: `image/${imageType}`,
      uploadedBy: userId,
    });

    const client = await postgres.connect();
    try {
      await ensureMemberTagSchema(client);
      const previousResult = await client.query(
        'SELECT avatar_url FROM members WHERE id = $1',
        [userId]
      );
      const previousAvatarUrl = previousResult.rows[0]?.avatar_url || null;
      const updateResult = await client.query(
        `
          UPDATE members
          SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2
          RETURNING id, name, email, role, avatar_color, avatar_url
        `,
        [avatarUrl, userId]
      );

      if (updateResult.rows.length === 0) {
        releaseStorageUrls([avatarUrl]);
        return res.status(404).json({ message: 'Usuario nao encontrado.' });
      }

      const user = await buildUserResponse(client, updateResult.rows[0]);

      res.json({
        message: 'Avatar (imagem) atualizado com sucesso.',
        user,
      });
      if (previousAvatarUrl && previousAvatarUrl !== avatarUrl) {
        releaseStorageUrls([previousAvatarUrl]);
      }
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof StorageError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Erro no upload de avatar:', error);
    res.status(500).json({ message: 'Erro ao fazer upload do avatar.' });
  }
});

router.put('/:id', verifyToken, requireOrganizationAdmin, async (req, res) => {
  const { name, role, tagIds, accessRole } = req.body;
  const targetId = req.params.id;
  const organizationId = req.user.organizationId;

  if (!name) {
    return res.status(400).json({ message: 'O nome e obrigatorio.' });
  }

  if (!organizationId) {
    return res.status(403).json({
      message: 'Conta sem empresa ativa. Faça login novamente.',
    });
  }

  const client = await postgres.connect();

  try {
    await ensureMemberTagSchema(client);
    const membershipResult = await client.query(
      'SELECT 1 FROM organization_members WHERE organization_id = $1 AND member_id = $2 AND status = $3',
      [organizationId, targetId, 'active']
    );

    if (membershipResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }

    const targetIsOwner = req.organizationAdmin.ownerMemberId === targetId;
    if (targetIsOwner && !req.organizationAdmin.isOwner) {
      return res.status(403).json({
        message: 'Somente o proprietario pode editar a conta do proprietario.',
      });
    }

    const currentRoleResult = await client.query('SELECT role FROM members WHERE id = $1', [targetId]);
    const jobTitle = await assertJobTitleAllowed(organizationId, role, {
      currentValue: currentRoleResult.rows[0]?.role || null,
    });

    const updateResult = await client.query(
      `
        UPDATE members
        SET name = $1, role = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING id, name, email, role, avatar_color, avatar_url
      `,
      [name, jobTitle, targetId]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }

    if (!targetIsOwner && (accessRole === 'admin' || accessRole === 'member')) {
      await client.query(
        'UPDATE organization_members SET role = $1 WHERE organization_id = $2 AND member_id = $3',
        [accessRole, organizationId, targetId]
      );
    }

    await replaceMemberTags(client, targetId, tagIds, organizationId);
    const user = await buildUserResponse(client, updateResult.rows[0]);

    res.json({
      message: 'Usuario atualizado com sucesso.',
      user,
    });
  } catch (error) {
    if (sendKnownError(res, error)) return;
    console.error('Erro ao editar usuario:', error);
    res.status(500).json({ message: 'Erro interno ao editar usuario.' });
  } finally {
    client.release();
  }
});

router.delete('/:id', verifyToken, requireOrganizationAdmin, async (req, res) => {
  const targetId = req.params.id;
  const currentUserId = req.user.id;
  const organizationId = req.user.organizationId;

  if (targetId === currentUserId) {
    return res.status(400).json({ message: 'Voce nao pode remover a si mesmo.' });
  }

  if (targetId === req.organizationAdmin.ownerMemberId) {
    return res.status(403).json({ message: 'O proprietario da empresa nao pode ser removido.' });
  }

  if (!organizationId) {
    return res.status(403).json({
      message: 'Conta sem empresa ativa. Faça login novamente.',
    });
  }

  const client = await postgres.connect();

  try {
    const membershipResult = await client.query(
      'DELETE FROM organization_members WHERE organization_id = $1 AND member_id = $2 RETURNING member_id',
      [organizationId, targetId]
    );

    if (membershipResult.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }

    res.json({ message: 'Usuario removido com sucesso.' });
  } catch (error) {
    console.error('Erro ao deletar usuario:', error);
    res.status(500).json({ message: 'Erro interno ao deletar usuario.' });
  } finally {
    client.release();
  }
});

module.exports = router;

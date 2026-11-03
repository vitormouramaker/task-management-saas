const { postgres } = require('../server/connect');

// Consulta o banco em vez de confiar no papel gravado no token, que pode estar
// desatualizado por ate 7 dias depois de um rebaixamento.
async function requireOrganizationAdmin(req, res, next) {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    return res.status(403).json({
      message: 'Conta sem empresa ativa. Faça login novamente.',
    });
  }

  const result = await postgres.query(
    `
      SELECT
        om.role AS "organizationRole",
        o.owner_member_id AS "ownerMemberId",
        o.name AS "organizationName"
      FROM organization_members om
      INNER JOIN organizations o ON o.id = om.organization_id
      WHERE om.member_id = $1
        AND om.organization_id = $2
        AND om.status = 'active'
    `,
    [req.user.id, organizationId]
  );

  const row = result.rows[0];
  const isOwner = Boolean(row) && (row.ownerMemberId === req.user.id || row.organizationRole === 'owner');
  const isAdmin = isOwner || row?.organizationRole === 'admin';

  if (!isAdmin) {
    return res.status(403).json({
      message: 'Apenas o titular ou administradores da conta podem fazer isso.',
    });
  }

  req.organizationAdmin = {
    isOwner,
    ownerMemberId: row.ownerMemberId,
    organizationName: row.organizationName,
  };
  next();
}

module.exports = { requireOrganizationAdmin };

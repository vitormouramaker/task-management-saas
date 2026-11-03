const jwt = require('jsonwebtoken');

const { JWT_SECRET } = require('../config/jwt');
const { getTokensValidFrom } = require('../services/session.service');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Acesso negado. Token não fornecido.' });
  }

  let verified;
  try {
    verified = jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return res.status(403).json({ message: 'Token inválido ou expirado.' });
  }

  // "Sair de todos os dispositivos" e troca de senha marcam a hora a partir da
  // qual os acessos já abertos param de valer.
  try {
    const validFromEpoch = await getTokensValidFrom(verified.id);
    if (validFromEpoch && verified.iat && verified.iat < validFromEpoch) {
      return res
        .status(401)
        .json({ message: 'Sessão encerrada. Faça login novamente.', code: 'SESSION_REVOKED' });
    }
  } catch (error) {
    // Falha de banco não pode derrubar o sistema inteiro: segue com o token válido.
    console.error('[auth] falha ao checar sessões encerradas', error?.message || error);
  }

  req.user = verified;
  next();
};

module.exports = {
  verifyToken
};

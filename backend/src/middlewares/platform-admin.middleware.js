const { getAllowedAdminIps, isPlatformAdmin } = require("../services/platform-admin.service");

/** Só a equipe do Pauta entra no painel de super-administrador. */
async function requirePlatformAdmin(req, res, next) {
  const allowedIps = getAllowedAdminIps();
  const ip = String(req.ip || "").replace(/^::ffff:/, "");
  if (allowedIps.length && !allowedIps.includes(ip)) {
    console.warn(`[super-admin] acesso negado para o IP ${ip} (${req.user?.email || "sem login"})`);
    return res.status(403).json({ message: "Acesso restrito à equipe do Pauta." });
  }

  try {
    if (await isPlatformAdmin(req.user?.id)) {
      return next();
    }
  } catch (error) {
    console.error("[super-admin] falha ao checar permissão", error?.message || error);
  }

  return res.status(403).json({ message: "Acesso restrito à equipe do Pauta." });
}

module.exports = { requirePlatformAdmin };

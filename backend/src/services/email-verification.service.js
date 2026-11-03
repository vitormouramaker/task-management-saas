const jwt = require("jsonwebtoken");
const { postgres } = require("../server/connect");
const { JWT_SECRET } = require("../config/jwt");
const { sendVerificationEmail } = require("../server/email");
const { AccountError } = require("./account.service");

// O e-mail entra no segredo: se o e-mail da conta mudar, links antigos deixam de valer.
function getVerificationSecret(email) {
  return `${JWT_SECRET}.verify-email.${String(email || "").toLowerCase()}`;
}

function createVerificationToken(member) {
  return jwt.sign({ id: member.id, purpose: "verify-email" }, getVerificationSecret(member.email), {
    expiresIn: "3d",
  });
}

/** Envia o link de confirmação. Nunca lança erro (retorna se o e-mail saiu). */
async function sendEmailVerification(member) {
  try {
    return await sendVerificationEmail({
      to: member.email,
      name: member.name,
      token: createVerificationToken(member),
    });
  } catch (error) {
    console.error("[email] falha ao enviar verificação", error?.message || error);
    return false;
  }
}

async function confirmEmailVerification(token) {
  const decoded = jwt.decode(String(token || ""));
  if (!decoded?.id || decoded.purpose !== "verify-email") {
    throw new AccountError(400, "Link de confirmação inválido.");
  }

  const result = await postgres.query(
    "SELECT id, email, email_verified_at FROM members WHERE id = $1",
    [decoded.id],
  );
  const member = result.rows[0];
  if (!member) {
    throw new AccountError(400, "Link de confirmação inválido.");
  }

  try {
    jwt.verify(token, getVerificationSecret(member.email));
  } catch (error) {
    throw new AccountError(
      400,
      error instanceof jwt.TokenExpiredError
        ? "Este link de confirmação expirou. Peça um novo link."
        : "Link de confirmação inválido.",
    );
  }

  await postgres.query(
    "UPDATE members SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP) WHERE id = $1",
    [member.id],
  );
  return { memberId: member.id, alreadyVerified: Boolean(member.email_verified_at) };
}

module.exports = {
  sendEmailVerification,
  confirmEmailVerification,
};

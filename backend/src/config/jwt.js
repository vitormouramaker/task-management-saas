require("./env");

function readRequiredSecret(name) {
  const value = String(process.env[name] || "").trim();

  if (value.length < 32) {
    throw new Error(
      `[config/jwt] ${name} ausente ou muito curto (minimo 32 caracteres). Defina no .env.`,
    );
  }

  return value;
}

const JWT_SECRET = readRequiredSecret("JWT_SECRET");
const JWT_REFRESH_SECRET = readRequiredSecret("JWT_REFRESH_SECRET");
// Token de acesso curto: se vazar, dura pouco. O front renova sozinho com o
// refresh token, que é revogável (tabela auth_sessions).
const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "1h";
const REFRESH_TOKEN_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "30d";

module.exports = {
  JWT_SECRET,
  JWT_REFRESH_SECRET,
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN,
};

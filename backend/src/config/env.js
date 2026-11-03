const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Precedência: variáveis do ambiente (Docker, terminal, testes) > .env.local
// (máquina do desenvolvedor, fora do git) > .env (o que vai para o deploy).
const fromEnvironment = new Set(Object.keys(process.env));

dotenv.config();

const localPath = path.resolve(process.cwd(), ".env.local");

if (fs.existsSync(localPath)) {
  const local = dotenv.parse(fs.readFileSync(localPath));

  for (const [key, value] of Object.entries(local)) {
    if (!fromEnvironment.has(key)) {
      process.env[key] = value;
    }
  }
}

module.exports = {};

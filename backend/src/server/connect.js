require("../config/env");
const { Pool, types } = require('pg');

// Colunas TIMESTAMP (sem timezone) sao gravadas em UTC pelo banco (TimeZone = Etc/UTC).
// Sem este parser o driver interpreta o valor no fuso do processo Node e desloca o horario
// (ex.: card criado 11:19 BRT era devolvido como 17:19Z e exibido como 14:19).
const PG_TIMESTAMP_OID = 1114;
const PG_TIMESTAMP_ARRAY_OID = 1115;

function parseUtcTimestamp(value) {
  if (value === null || value === undefined) {
    return value;
  }

  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(`${normalized}Z`);
}

types.setTypeParser(PG_TIMESTAMP_OID, parseUtcTimestamp);
types.setTypeParser(PG_TIMESTAMP_ARRAY_OID, (value) => {
  if (value === null || value === undefined) {
    return value;
  }

  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .filter(Boolean)
    .map((item) => parseUtcTimestamp(item.replace(/^"|"$/g, '')));
});

const postgres = new Pool({
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,

  // Pool settings
  max: Number(process.env.DB_POOL_MAX || 20),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  allowExitOnIdle: true,

  // Query timeouts
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 30000),
  keepAlive: true,
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Fechando pool de conexoes...');
  await postgres.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Fechando pool de conexoes...');
  await postgres.end();
  process.exit(0);
});

module.exports = { postgres };

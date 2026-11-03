require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { postgres } = require('./connect');

async function run() {
  const client = await postgres.connect();
  try {
    await client.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);`);
    console.log('Coluna avatar_url adicionada com sucesso.');
  } catch (err) {
    console.error('Erro ao adicionar coluna:', err);
  } finally {
    client.release();
    process.exit(0);
  }
}

run();

const { postgres } = require('./connect');

async function migrate() {
  console.log('Adding recipient_id and type columns to sent_emails...');
  const client = await postgres.connect();
  try {
    await client.query(`
      ALTER TABLE sent_emails
        ADD COLUMN IF NOT EXISTS recipient_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'sent';
    `);
    console.log('Migration successful.');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();

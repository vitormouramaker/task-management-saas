const { postgres } = require('./connect');

async function migrate() {
  console.log('Creating sent_emails table...');
  const client = await postgres.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS sent_emails (
        id          VARCHAR(100) PRIMARY KEY,
        sender_id   VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
        to_email    VARCHAR(255) NOT NULL,
        subject     VARCHAR(255) NOT NULL,
        subtitle    VARCHAR(255),
        body        TEXT NOT NULL,
        attachments TEXT[] DEFAULT '{}',
        read        BOOLEAN DEFAULT FALSE,
        sent_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Migration successful: sent_emails created.');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();

const { postgres } = require('./connect');

async function migrate() {
  console.log('Adding icon column to workspaces...');
  const client = await postgres.connect();
  try {
    await client.query(`
      ALTER TABLE workspaces
        ADD COLUMN IF NOT EXISTS icon VARCHAR(50) DEFAULT 'Briefcase';
    `);
    console.log('Migration successful: icon added to workspaces.');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();

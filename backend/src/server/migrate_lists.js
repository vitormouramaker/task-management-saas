const { postgres } = require('./connect');

async function migrate() {
    console.log('Starting migration...');
    const client = await postgres.connect();
    try {
        await client.query(`ALTER TABLE lists ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;`);
        console.log('Migration successful: deleted_at added to lists.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrate();

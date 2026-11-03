const { postgres } = require('./connect');

async function migrate() {
    console.log('Adding created_by to notifications...');
    const client = await postgres.connect();
    try {
        await client.query(`
            ALTER TABLE notifications
            ADD COLUMN IF NOT EXISTS created_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL;
        `);
        console.log('Migration successful: created_by added to notifications.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrate();

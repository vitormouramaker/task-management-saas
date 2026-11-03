const { postgres } = require('./connect');

async function migrateWorkspaceSoftDelete() {
    console.log('Adicionando coluna deleted_at à tabela workspaces...');
    const client = await postgres.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(`
            ALTER TABLE workspaces 
            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
        `);

        await client.query('COMMIT');
        console.log('✅ Coluna deleted_at adicionada com sucesso!');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Erro na migração workspaces deleted_at:', e);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrateWorkspaceSoftDelete();

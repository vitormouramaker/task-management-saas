const { postgres } = require('./connect');

async function migrateWorkspaceTags() {
    console.log('Iniciando migração para workspace_tags...');
    const client = await postgres.connect();
    try {
        await client.query('BEGIN');
        
        // Tabela de Relação M-N entre Workspaces e Tags
        await client.query(`
            CREATE TABLE IF NOT EXISTS workspace_tags (
                workspace_id VARCHAR(100) REFERENCES workspaces(id) ON DELETE CASCADE,
                tag_id VARCHAR(100) REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (workspace_id, tag_id)
            );
        `);

        await client.query('COMMIT');
        console.log('✅ Tabela workspace_tags criada com sucesso!');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Erro na migração workspace_tags:', e);
    } finally {
        client.release();
        process.exit(0);
    }
}

migrateWorkspaceTags();

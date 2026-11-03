require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const { postgres } = require("./connect");

async function createTables() {
  const client = await postgres.connect();

  try {
    console.log("Iniciando a criaÃ§Ã£o das tabelas...");
    await client.query("BEGIN");

    // Tabela de UsuÃ¡rios (Members)
    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255),
        avatar_color VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE members
      ADD COLUMN IF NOT EXISTS active_organization_id VARCHAR(100)
    `);
    console.log("Tabela members criada.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE,
        plan VARCHAR(50) NOT NULL DEFAULT 'free',
        subscription_status VARCHAR(50) NOT NULL DEFAULT 'free',
        stripe_customer_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        billing_interval VARCHAR(50),
        owner_member_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Tabela organizations criada.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS organization_members (
        organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE CASCADE,
        member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL DEFAULT 'member',
        status VARCHAR(50) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (organization_id, member_id)
      );
    `);
    await client.query(`
      ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS billing_interval VARCHAR(50)
    `);
    console.log("Tabela organization_members criada.");

    // Tabela de Workspaces
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        visibility VARCHAR(50) DEFAULT 'private',
        owner_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS default_permission_level VARCHAR(50) DEFAULT 'EdiÃ§Ã£o total'
    `);
    await client.query(`
      ALTER TABLE workspaces
      ADD COLUMN IF NOT EXISTS organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE CASCADE
    `);
    console.log("Tabela workspaces criada.");

    // RelaÃ§Ã£o M-N Workspaces e Membros
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id VARCHAR(100) REFERENCES workspaces(id) ON DELETE CASCADE,
        member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
        permission_level VARCHAR(50) DEFAULT 'EdiÃ§Ã£o total',
        PRIMARY KEY (workspace_id, member_id)
      );
    `);

    // Tabela de EspaÃ§os (Spaces)
    await client.query(`
      CREATE TABLE IF NOT EXISTS spaces (
        id VARCHAR(100) PRIMARY KEY,
        workspace_id VARCHAR(100) REFERENCES workspaces(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        icon VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Tabela spaces criada.");

    // Tabela de Pastas (Folders)
    await client.query(`
      CREATE TABLE IF NOT EXISTS folders (
        id VARCHAR(100) PRIMARY KEY,
        space_id VARCHAR(100) REFERENCES spaces(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Tabela folders criada.");

    // Tabela de Projetos / Listas (Lists)
    await client.query(`
      CREATE TABLE IF NOT EXISTS lists (
        id VARCHAR(100) PRIMARY KEY,
        folder_id VARCHAR(100) REFERENCES folders(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        color_class VARCHAR(50),
        owner_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
        visibility VARCHAR(50) DEFAULT 'public',
        start_date TIMESTAMP,
        due_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Tabela lists (projetos) criada.");

    // RelaÃ§Ã£o M-N AtribuÃ­dos da Lista
    await client.query(`
      CREATE TABLE IF NOT EXISTS list_assignees (
        list_id VARCHAR(100) REFERENCES lists(id) ON DELETE CASCADE,
        member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
        PRIMARY KEY (list_id, member_id)
      );
    `);

    // Tabela de Tags
    await client.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        color VARCHAR(50)
      );
    `);
    await client.query(`
      ALTER TABLE tags
      ADD COLUMN IF NOT EXISTS organization_id VARCHAR(100) REFERENCES organizations(id) ON DELETE CASCADE
    `);
    console.log("Tabela tags criada.");
    await client.query(`
      CREATE TABLE IF NOT EXISTS member_tags (
        member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
        tag_id VARCHAR(100) REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (member_id, tag_id)
      );
    `);
    console.log("Tabela member_tags criada.");

    // RelaÃ§Ã£o M-N Tags da Lista e Tarefas
    await client.query(`
      CREATE TABLE IF NOT EXISTS list_tags (
        list_id VARCHAR(100) REFERENCES lists(id) ON DELETE CASCADE,
        tag_id VARCHAR(100) REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (list_id, tag_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_tags (
        task_id VARCHAR(100), -- ReferÃªncia adicionada depois
        tag_id VARCHAR(100) REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
      );
    `);

    // Tabela de DefiniÃ§Ãµes de Status
    await client.query(`
      CREATE TABLE IF NOT EXISTS status_definitions (
        id VARCHAR(100) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        color_class VARCHAR(100),
        chip_class VARCHAR(100),
        dot_class VARCHAR(100),
        display_order INTEGER NOT NULL
      );
    `);
    // Coluna por lista/projeto: NULL = status global (padrão, compartilhado)
    await client.query(`
      ALTER TABLE status_definitions
      ADD COLUMN IF NOT EXISTS list_id VARCHAR(100) REFERENCES lists(id) ON DELETE CASCADE
    `);
    console.log("Tabela status_definitions criada.");

    // Tabela de Tarefas (Tasks)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id VARCHAR(100) PRIMARY KEY,
        workspace_id VARCHAR(100) REFERENCES workspaces(id) ON DELETE CASCADE,
        space_id VARCHAR(100) REFERENCES spaces(id) ON DELETE CASCADE,
        folder_id VARCHAR(100) REFERENCES folders(id) ON DELETE CASCADE,
        list_id VARCHAR(100) REFERENCES lists(id) ON DELETE CASCADE,
        parent_task_id VARCHAR(100) REFERENCES tasks(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status_id VARCHAR(100) REFERENCES status_definitions(id) ON DELETE SET NULL,
        priority VARCHAR(50),
        start_date TIMESTAMP,
        due_date TIMESTAMP,
        estimate VARCHAR(100),
        description_link_display_modes JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Tabela tasks criada.");

    // RelaÃ§Ã£o Tarefas x Membros
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_assignees (
        task_id VARCHAR(100) REFERENCES tasks(id) ON DELETE CASCADE,
        member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, member_id)
      );
    `);

    // Agora podemos adicionar a constraint de task_tags que faltava (com verificaÃ§Ã£o)
    await client.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE constraint_name = 'fk_task') THEN
          ALTER TABLE task_tags ADD CONSTRAINT fk_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);

    // Tabela de VÃ­nculos de Tarefas (Links)
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_links (
        task_id VARCHAR(100) REFERENCES tasks(id) ON DELETE CASCADE,
        linked_task_id VARCHAR(100) REFERENCES tasks(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, linked_task_id)
      );
    `);
    console.log("Tabela task_links criada ou jÃ¡ existente.");

    // Tabela de ComentÃ¡rios
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id VARCHAR(100) PRIMARY KEY,
        task_id VARCHAR(100) REFERENCES tasks(id) ON DELETE CASCADE,
        author_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
        parent_id VARCHAR(100) REFERENCES task_comments(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE task_comments
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS attachment_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS attachment_type VARCHAR(50),
      ADD COLUMN IF NOT EXISTS attachment_size BIGINT,
      ADD COLUMN IF NOT EXISTS liked_user_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
      ADD COLUMN IF NOT EXISTS reaction VARCHAR(32),
      ADD COLUMN IF NOT EXISTS link_display_modes JSONB DEFAULT '{}'::jsonb
    `);
    console.log("Tabela task_comments criada.");

    // Tabela de Anexos
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_attachments (
        id VARCHAR(100) PRIMARY KEY,
        task_id VARCHAR(100) REFERENCES tasks(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        url VARCHAR(500) NOT NULL,
        type VARCHAR(50),
        size BIGINT,
        uploaded_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE tasks
      ADD COLUMN IF NOT EXISTS cover_attachment_id VARCHAR(100)
    `);
    await client.query(`
      ALTER TABLE task_attachments
      ADD COLUMN IF NOT EXISTS uploaded_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL
    `);
    console.log("Tabela task_attachments criada.");

    // Tabela de Atividades
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_activities (
        id VARCHAR(100) PRIMARY KEY,
        task_id VARCHAR(100) REFERENCES tasks(id) ON DELETE CASCADE,
        author_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Garantir que a coluna author_id exista caso a tabela jÃ¡ estivesse criada
    try {
      // Savepoint: se a coluna ja existir, o erro nao derruba a transacao toda.
      await client.query("SAVEPOINT alterar_task_activities");
      await client.query(
        "ALTER TABLE task_activities ADD COLUMN author_id VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL",
      );
      await client.query("RELEASE SAVEPOINT alterar_task_activities");
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT alterar_task_activities");
      /* Coluna jÃ¡ existe ou erro de alter */
    }

    console.log("Tabela task_activities criada.");

    // Tabela de Checklists
    await client.query(`
      CREATE TABLE IF NOT EXISTS checklists (
        id VARCHAR(100) PRIMARY KEY,
        task_id VARCHAR(100) REFERENCES tasks(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS checklist_items (
        id VARCHAR(100) PRIMARY KEY,
        checklist_id VARCHAR(100) REFERENCES checklists(id) ON DELETE CASCADE,
        label VARCHAR(255) NOT NULL,
        done BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // RelaÃ§Ã£o itens de checklist x membros
    await client.query(`
      CREATE TABLE IF NOT EXISTS checklist_item_assignees (
        checklist_item_id VARCHAR(100) REFERENCES checklist_items(id) ON DELETE CASCADE,
        member_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
        PRIMARY KEY (checklist_item_id, member_id)
      );
    `);
    console.log("Tabelas de checklists criadas.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(100) PRIMARY KEY,
        user_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        type VARCHAR(50) NOT NULL,
        reference_id VARCHAR(100) NOT NULL,
        read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL
      );
    `);
    console.log("Tabela notifications criada.");

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_push_tokens (
        fcm_token TEXT PRIMARY KEY,
        user_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
        app_origin TEXT,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Tabela user_push_tokens criada.");

    await client.query("COMMIT");
    console.log("Todas as tabelas foram criadas/verificadas com sucesso!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao criar tabelas:", error);
  } finally {
    client.release();
    process.exit(0);
  }
}

createTables();

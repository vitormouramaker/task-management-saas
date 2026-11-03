const { postgres } = require("./connect");

async function migratePushTokens() {
  console.log("Starting push tokens migration...");
  const client = await postgres.connect();
  try {
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
    await client.query(`
      ALTER TABLE user_push_tokens
      ADD COLUMN IF NOT EXISTS user_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS app_origin TEXT,
      ADD COLUMN IF NOT EXISTS user_agent TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);
    await client.query(`
      DO $$
      DECLARE
        pk_name TEXT;
        pk_definition TEXT;
      BEGIN
        SELECT con.conname, pg_get_constraintdef(con.oid)
        INTO pk_name, pk_definition
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE rel.relname = 'user_push_tokens'
          AND con.contype = 'p';

        IF pk_name IS NOT NULL AND pk_definition ILIKE '%(user_id)%' THEN
          EXECUTE format('ALTER TABLE user_push_tokens DROP CONSTRAINT %I', pk_name);
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          WHERE rel.relname = 'user_push_tokens'
            AND con.contype = 'p'
        ) THEN
          ALTER TABLE user_push_tokens
          ADD CONSTRAINT user_push_tokens_pkey PRIMARY KEY (fcm_token);
        END IF;
      END $$;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id
      ON user_push_tokens (user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_push_tokens_app_origin
      ON user_push_tokens (app_origin)
    `);
    console.log("Migration successful: table user_push_tokens added.");
  } catch (e) {
    console.error("Migration failed:", e);
  } finally {
    client.release();
    process.exit(0);
  }
}

migratePushTokens();

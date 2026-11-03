const { postgres } = require("./connect");

async function migrateNotifications() {
  console.log("Starting notifications migration...");
  const client = await postgres.connect();
  try {
    await client.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id VARCHAR(100) PRIMARY KEY,
                user_id VARCHAR(100) REFERENCES members(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                message TEXT,
                type VARCHAR(50) NOT NULL, -- 'TASK_ASSIGNED', 'LIST_ASSIGNED', 'WORKSPACE_ASSIGNED'
                reference_id VARCHAR(100) NOT NULL, -- Task ID, List ID, Workspace ID
                read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL
            );
        `);
    await client.query(`
            ALTER TABLE notifications
            ADD COLUMN IF NOT EXISTS created_by VARCHAR(100) REFERENCES members(id) ON DELETE SET NULL
        `);
    await client.query(`
            CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
            ON notifications (user_id, created_at DESC)
        `);
    console.log("Migration successful: table notifications added.");
  } catch (e) {
    console.error("Migration failed:", e);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrateNotifications();

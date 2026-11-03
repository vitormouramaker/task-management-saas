const { postgres } = require("./connect");

const defaultStatuses = [
  {
    id: "st_backlog",
    name: "Lista de Espera",
    colorClass: "bg-slate-50",
    chipClass: "bg-slate-100 text-slate-700 ring-slate-200",
    dotClass: "bg-slate-500",
    order: 1,
  },
  {
    id: "st_todo",
    name: "A Fazer",
    colorClass: "bg-blue-50/50",
    chipClass: "bg-sky-100 text-sky-700 ring-sky-200",
    dotClass: "bg-blue-600",
    order: 2,
  },
  {
    id: "st_progress",
    name: "Em Andamento",
    colorClass: "bg-orange-50/50",
    chipClass: "bg-amber-100 text-amber-700 ring-amber-200",
    dotClass: "bg-orange-500",
    order: 3,
  },
  {
    id: "st_review",
    name: "Em Revisão",
    colorClass: "bg-violet-50/50",
    chipClass: "bg-violet-100 text-violet-700 ring-violet-200",
    dotClass: "bg-violet-500",
    order: 4,
  },
  {
    id: "st_done",
    name: "Concluído",
    colorClass: "bg-emerald-50/50",
    chipClass: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    dotClass: "bg-emerald-500",
    order: 5,
  },
];

async function seedStatuses() {
  console.log("Sincronizando status no banco de dados...");
  const client = await postgres.connect();
  try {
    await client.query("BEGIN");
    for (const status of defaultStatuses) {
      await client.query(
        `
                INSERT INTO status_definitions (id, name, color_class, chip_class, dot_class, display_order)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    color_class = EXCLUDED.color_class,
                    chip_class = EXCLUDED.chip_class,
                    dot_class = EXCLUDED.dot_class,
                    display_order = EXCLUDED.display_order
            `,
        [
          status.id,
          status.name,
          status.colorClass,
          status.chipClass,
          status.dotClass,
          status.order,
        ],
      );
    }
    await client.query("COMMIT");
    console.log("✅ Status sincronizados com sucesso!");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("❌ Erro ao sincronizar status:", e);
  } finally {
    client.release();
    process.exit(0);
  }
}

seedStatuses();

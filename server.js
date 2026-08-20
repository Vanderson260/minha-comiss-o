import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 10000);
const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } }) : null;

app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS minha_comissao_snapshot (
      id integer PRIMARY KEY DEFAULT 1,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

app.get("/api/health", async (_req, res) => {
  try {
    if (!pool) return res.status(503).json({ ok: false, error: "NEON_DATABASE_URL não configurada" });
    await pool.query("SELECT 1");
    res.json({ ok: true, app: "Minha Comissão", database: "connected" });
  } catch (error) {
    res.status(503).json({ ok: false, error: "Banco indisponível" });
  }
});

app.get("/api/snapshot", async (_req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: "Banco não configurado" });
    const result = await pool.query("SELECT data, updated_at FROM minha_comissao_snapshot WHERE id = 1");
    if (result.rows[0]) return res.json(result.rows[0]);
    try {
      const legacy = await pool.query('SELECT data, "updatedAt" AS updated_at FROM app_snapshots ORDER BY "updatedAt" DESC LIMIT 1');
      if (legacy.rows[0]) return res.json(legacy.rows[0]);
    } catch (_legacyError) {
      // A tabela legada pode não existir em uma base Neon nova.
    }
    res.json({ data: null, updated_at: null });
  } catch (error) {
    console.error("[snapshot:get]", error);
    res.status(500).json({ error: "Não foi possível carregar os dados" });
  }
});

app.put("/api/snapshot", async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: "Banco não configurado" });
    const data = req.body;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return res.status(400).json({ error: "Snapshot inválido" });
    }
    await pool.query(
      `INSERT INTO minha_comissao_snapshot (id, data, updated_at)
       VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [JSON.stringify(data)],
    );
    res.json({ ok: true });
  } catch (error) {
    console.error("[snapshot:put]", error);
    res.status(500).json({ error: "Não foi possível salvar os dados" });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  try {
    await ensureSchema();
    app.listen(port, "0.0.0.0", () => console.log(`Minha Comissão online na porta ${port}`));
  } catch (error) {
    console.error("[startup] Falha ao preparar o banco", error);
    app.listen(port, "0.0.0.0", () => console.log(`Minha Comissão online na porta ${port} sem banco`));
  }
}

start();

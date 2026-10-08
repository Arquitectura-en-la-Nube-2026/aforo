import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

/**
 * Applies migrations/*.sql in filename order, each once (tracked in schema_migration). Needs only
 * DATABASE_URL, so the migration job (build-and-deploy.md) does not carry the service's config.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const dir = join(__dirname, "..", "..", "migrations");
    for (const file of readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const done = await client.query("SELECT 1 FROM schema_migration WHERE name = $1", [file]);
      if (done.rowCount) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(join(dir, file), "utf8"));
        await client.query("INSERT INTO schema_migration (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(
          JSON.stringify({ severity: "INFO", message: "migration_applied", event: "migration_applied", file }),
        );
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    JSON.stringify({ severity: "CRITICAL", message: "migration_failed", event: "migration_failed", error: message }),
  );
  process.exit(1);
});

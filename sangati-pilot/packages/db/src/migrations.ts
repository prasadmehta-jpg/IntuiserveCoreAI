import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './db';
import { SCHEMA_SQL } from './schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

export function runMigrations(): void {
  const db = getDb();

  // Step 1: Apply the base schema (idempotent — all statements use IF NOT EXISTS)
  db.exec(SCHEMA_SQL);

  // Step 2: Ensure migration tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      filename   TEXT NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Step 3: Read .sql files from migrations/ in numeric order
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[db] No migrations folder found — skipping file-based migrations.');
    console.log('[db] Migrations applied successfully');
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    const row = db
      .prepare('SELECT id FROM _migrations WHERE filename = ?')
      .get(filename) as { id: number } | undefined;

    if (row) continue; // already applied

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');

    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (filename) VALUES (?)').run(filename);
      db.exec('COMMIT');
      console.log(`[db] Applied migration: ${filename}`);
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw new Error(`Migration ${filename} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log('[db] Migrations applied successfully');
}

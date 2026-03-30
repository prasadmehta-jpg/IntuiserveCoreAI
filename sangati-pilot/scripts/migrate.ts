#!/usr/bin/env tsx
/**
 * pnpm db:migrate
 * Applies SQLite schema. Safe to run multiple times (idempotent).
 * Run from repo root: pnpm db:migrate
 */

import 'dotenv/config';
import path from 'path';

// Resolve DB path relative to repo root (where this script is called from)
process.env.DATABASE_PATH ??= path.resolve(process.cwd(), 'data/sangati.db');

import { runMigrations } from '../packages/db/src/index';

runMigrations();
console.log('✅  Migration complete.');

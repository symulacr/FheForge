#!/usr/bin/env node

/**
 * MC-095: Safe Migration Runner
 *
 * Reads migration files from the migrations/ directory, checks the _migrations
 * tracking table to determine which have already been applied, and applies
 * any pending ones in order.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_KEY=... node migrations/run-migration.js
 *
 * Environment:
 *   SUPABASE_URL   — Supabase project URL
 *   SUPABASE_KEY   — Supabase service_role key (required for DDL)
 *   SUPABASE_DB_URL — Optional direct PostgreSQL connection string
 *                     (if set, uses pg client instead of exec_sql RPC)
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("node:fs");
const path = require("node:path");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;

if (!supabaseUrl || !supabaseKey) {
	console.error("SUPABASE_URL and SUPABASE_KEY must be set");
	process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

/** Ordered list of migration files to apply. */
const MIGRATION_FILES = [
	"000_base.sql",
	"001_event_indexing_tables.sql",
	"002_defi_action_required.sql",
	"003_auth_nonces.sql",
];

/**
 * Execute raw SQL against the database.
 * Uses SUPABASE_DB_URL (direct pg) if available, otherwise falls back to
 * the exec_sql RPC function (requires the function to exist in the DB).
 */
async function execSql(sql) {
	if (dbUrl) {
		// Direct PostgreSQL connection (preferred — avoids RPC dependency)
		const { default: pg } = await import("pg");
		const client = new pg.Client({ connectionString: dbUrl });
		try {
			await client.connect();
			await client.query(sql);
		} finally {
			await client.end();
		}
	} else {
		// Fallback to exec_sql RPC (requires the function to exist)
		const { error } = await supabase.rpc("exec_sql", { sql });
		if (error) throw error;
	}
}

/**
 * Get the set of already-applied migration filenames.
 */
async function _getAppliedMigrations() {
	// First ensure the _migrations table exists
	const { error } = await supabase
		.from("_migrations")
		.select("filename")
		.catch(() => ({ error: new Error("_migrations table not found") }));

	if (error) {
		// If the table doesn't exist yet, run 000_base.sql first
		console.log("_migrations table not found — applying base migration");
		return new Set();
	}

	const { data } = await supabase.from("_migrations").select("filename");

	return new Set((data || []).map((r) => r.filename));
}

/**
 * Register a migration as applied.
 */
async function recordMigration(filename) {
	const { error } = await supabase.from("_migrations").insert({ filename });

	if (error) {
		console.error(`Failed to record migration ${filename}:`, error.message);
		process.exit(1);
	}
}

async function runMigration() {
	// Ensure base migration is applied first (creates _migrations table)
	const baseSql = fs.readFileSync(path.join(__dirname, "000_base.sql"), "utf8");
	await execSql(baseSql);
	console.log("Base migration applied (000_base.sql)");

	// Determine which migrations have already been applied
	const applied = new Set();
	const { data: rows } = await supabase.from("_migrations").select("filename");

	if (rows) {
		for (const row of rows) {
			applied.add(row.filename);
		}
	}

	// Apply pending migrations in order
	for (const filename of MIGRATION_FILES) {
		if (applied.has(filename)) {
			console.log(`Skipping ${filename} — already applied`);
			continue;
		}

		const filePath = path.join(__dirname, filename);
		if (!fs.existsSync(filePath)) {
			console.error(`Migration file not found: ${filePath}`);
			process.exit(1);
		}

		const sql = fs.readFileSync(filePath, "utf8");
		console.log(`Applying ${filename}...`);

		try {
			await execSql(sql);
		} catch (error) {
			console.error(`Migration ${filename} failed:`, error.message);
			process.exit(1);
		}

		// Check if the migration already registered itself (000_base.sql does)
		if (!applied.has(filename)) {
			await recordMigration(filename);
		}

		console.log(`  ✓ ${filename} applied`);
	}

	console.log("All migrations applied successfully");
}

runMigration().catch((err) => {
	console.error("Migration runner failed:", err.message);
	process.exit(1);
});

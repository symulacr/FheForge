#!/usr/bin/env node

/**
 * MC-55: Migration Runner
 * Executes SQL migrations for event indexing tables
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL and SUPABASE_KEY must be set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  const migrationFile = path.join(__dirname, '001_event_indexing_tables.sql');
  const sql = fs.readFileSync(migrationFile, 'utf8');

  try {
    const { error } = await supabase.rpc('exec_sql', { sql });
    if (error) throw error;
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();

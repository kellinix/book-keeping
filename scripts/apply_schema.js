const fs = require('fs');
const { Client } = require('pg');

async function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL;
  if (!databaseUrl) {
    console.error('Missing DATABASE_URL/SUPABASE_DB_URL environment variable.');
    process.exit(1);
  }

  const sql = fs.readFileSync('db/schema.sql', 'utf8');
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    console.log('Connected to database. Applying schema...');
    await client.query(sql);
    console.log('Schema applied successfully.');
  } catch (err) {
    console.error('Failed to apply schema:', err.message || err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();

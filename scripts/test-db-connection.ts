import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../src/database/database-options';

async function main() {
  const url = process.argv[2] || process.env.DATABASE_URL;

  if (!url) {
    console.error('❌ Error: DATABASE_URL is not set.');
    console.log('Usage: ts-node scripts/test-db-connection.ts [optional-database-url]');
    process.exit(1);
  }

  // Mask credentials for display
  const maskedUrl = url.replace(/:([^:@]+)@/, ':****@');
  console.log(`🔌 Testing connection to: ${maskedUrl}`);

  const dataSource = new DataSource(databaseOptions(url));

  try {
    await dataSource.initialize();
    console.log('✅ Connection established successfully!');

    const versionResult = await dataSource.query('SELECT version();');
    console.log(`📦 Database version: ${versionResult[0]?.version?.split(' on ')[0] || 'Unknown'}`);

    const vectorResult = await dataSource.query(
      "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';",
    );

    if (vectorResult.length > 0) {
      console.log(`🚀 pgvector extension is ENABLED! (Version: ${vectorResult[0].extversion})`);
    } else {
      console.warn('⚠️  pgvector extension is NOT yet enabled.');
      console.log('   Run: CREATE EXTENSION IF NOT EXISTS vector; in your Supabase SQL Editor.');
    }

    const migrationTable = await dataSource.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'schema_migrations';
    `);

    if (migrationTable.length > 0) {
      const migrations = await dataSource.query(
        'SELECT name FROM schema_migrations ORDER BY timestamp ASC;',
      );
      console.log(`📑 Migrations applied: ${migrations.length}`);
    } else {
      console.log('ℹ️  No migrations applied yet. Run: pnpm migration:run to apply them.');
    }

    console.log('\n🎉 Database is ready for Continuum!');
  } catch (error: any) {
    console.error('\n❌ Connection failed:');
    console.error(error.message);
    if (error.message.includes('ssl') || error.message.includes('SSL')) {
      console.log(
        '\n💡 Tip: For Supabase, ensure your connection string ends with ?sslmode=require',
      );
    }
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

main();

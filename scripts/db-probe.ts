/**
 * Pre-flight probe: confirms we can reach the database, reports the server
 * version, and verifies the extensions the schema depends on are installable.
 * Run with: npx tsx scripts/db-probe.ts
 */
// Load .env before anything reads process.env (tsx does not do this for us,
// and the safety interlocks below must see the real DATABASE_URL).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const started = Date.now();
  const [version] = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version()`;
  console.log(`✓ connected in ${Date.now() - started}ms`);
  console.log(`  ${version?.version}`);

  const available = await prisma.$queryRaw<Array<{ name: string; default_version: string }>>`
    SELECT name, default_version FROM pg_available_extensions
    WHERE name IN ('pg_trgm', 'uuid-ossp')
    ORDER BY name
  `;
  console.log("\navailable extensions:");
  for (const e of available) console.log(`  • ${e.name} (v${e.default_version})`);
  if (available.length < 2) {
    console.warn("  ⚠ one or more required extensions are NOT available on this server");
  }

  for (const ext of ["pg_trgm", '"uuid-ossp"']) {
    try {
      await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS ${ext};`);
      console.log(`✓ CREATE EXTENSION ${ext} ok`);
    } catch (e) {
      console.error(`✗ CREATE EXTENSION ${ext} failed:`, (e as Error).message);
    }
  }

  const [iso] = await prisma.$queryRaw<Array<{ setting: string }>>`
    SELECT setting FROM pg_settings WHERE name = 'default_transaction_isolation'
  `;
  console.log(`\ndefault isolation: ${iso?.setting}`);

  const [maxConn] = await prisma.$queryRaw<Array<{ setting: string }>>`
    SELECT setting FROM pg_settings WHERE name = 'max_connections'
  `;
  console.log(`max_connections: ${maxConn?.setting}`);

  const tables = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM information_schema.tables WHERE table_schema = 'public'
  `;
  console.log(`existing public tables: ${Number(tables[0]?.count ?? 0)}`);
}

main()
  .catch((e) => {
    console.error("✗ probe failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// The limited login (scripts/setup-db-users.mjs) cannot change the structure: migrations use the full-rights one when it is saved.
if (process.env.MIGRATE_DATABASE_URL) process.env.DATABASE_URL = process.env.MIGRATE_DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
});

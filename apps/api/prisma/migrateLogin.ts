// Import this first in any script that changes the database structure or clears data (seed, data:clear).
// When the system has its own limited login (scripts/setup-db-users.mjs), those scripts use the full-rights one saved as MIGRATE_DATABASE_URL.
import 'dotenv/config';

if (process.env.MIGRATE_DATABASE_URL) process.env.DATABASE_URL = process.env.MIGRATE_DATABASE_URL;

import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` produces SQL from src/schema; partitions, roles and RLS
// policies are hand-written in migrations/ (docs/05 §9). `drizzle-kit push` is banned.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/agent_sales',
  },
  strict: true,
  verbose: true,
});

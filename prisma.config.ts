import { defineConfig } from 'prisma/config'
import 'dotenv/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx ./prisma/seed.ts',
  },
  datasource: {
    // Used by CLI/migrations only. Not required for `prisma generate` (build
    // on Vercel): without it, generate still works and migrate fails clearly.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
})
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Only `db:migrate`/`db:push`/`db:studio` use this; `db:generate` works offline.
    url: process.env.DATABASE_URL ?? "",
  },
});

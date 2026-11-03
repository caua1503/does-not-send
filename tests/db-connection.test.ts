// Define DATABASE_URL antes de qualquer import (ESM hoisting)
// Usa TEST_DATABASE_URL ou fallback para conexão de teste padrão
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 
  "postgres://doesnotsend:changeme@localhost:5432/doesnotsend_test";

import { describe, test, expect, afterAll } from "vitest";
import { sql, closeDatabase } from "../src/db/db.js";

describe("db-connection", () => {
  afterAll(async () => {
    await closeDatabase();
  });

  test("fecha conexão corretamente", async () => {
    await expect(closeDatabase()).resolves.not.toThrow();
  });
});

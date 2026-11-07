// Requires `npm run infra:up` (Postgres + pgvector on localhost:5432)
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import pgvector from "pgvector/pg";
import { env } from "../../src/config/env.js";
import { createPool } from "../../src/db/pool.js";

const pool = createPool(env.DATABASE_URL);
after(() => pool.end());

describe("Postgres + pgvector", () => {
  it("has the vector extension installed", async () => {
    const { rows } = await pool.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    );
    assert.ok(rows[0], "vector extension not found. Did init.sql run?");
  });

  it("stores vectors, runs a similarity search, and converts results back to arrays", async () => {
    const client = await pool.connect();
    try {
      await client.query("CREATE TEMP TABLE items (id int PRIMARY KEY, embedding vector(3))");
      await client.query(
        "INSERT INTO items VALUES (1, $1), (2, $2), (3, $3)",
        [[1, 0, 0], [0, 1, 0], [0.9, 0.1, 0]].map((v) => pgvector.toSql(v)),
      );

      const { rows } = await client.query<{ id: number; embedding: number[] }>(
        "SELECT id, embedding FROM items ORDER BY embedding <=> $1 LIMIT 2",
        [pgvector.toSql([1, 0, 0])],
      );

      assert.deepEqual(rows.map((r) => r.id), [1, 3]);
      // registerTypes (via onConnect) makes the driver return number[] instead of a string
      assert.deepEqual(rows[0]?.embedding, [1, 0, 0]);
    } finally {
      client.release();
    }
  });
});

import pg from "pg";
import pgvector from "pgvector/pg";
import { env } from "../config/env.js";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    // Awaited by the pool before handing out the client: registers the `vector` type on each new connection
    onConnect: (client) => pgvector.registerTypes(client),
  });
}

export const pool = createPool(env.DATABASE_URL);

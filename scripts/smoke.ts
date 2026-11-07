// Checks connectivity to Postgres/pgvector and SQS (local ElasticMQ)
import { pool } from "../src/db/pool.js";
import { env } from "../src/config/env.js";
import { sqsClient } from "../src/queue/sqs-client.js";
import { SqsQueue } from "../src/queue/sqs-queue.js";

const { rows } = await pool.query<{ extversion: string }>(
  "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
);
console.log("pgvector:", rows[0]?.extversion ?? "NOT INSTALLED");

const queue = new SqsQueue<{ ping: string }>(sqsClient, env.SQS_QUEUE_URL);
console.log("queue url:", queue.queueUrl);
const id = await queue.send({ ping: new Date().toISOString() });
console.log("sent:", id);
const [msg] = await queue.receive({ waitTimeSeconds: 2 });
if (msg) {
  console.log("received:", queue.parse(msg));
  await queue.ack(msg);
}

sqsClient.destroy();
await pool.end();

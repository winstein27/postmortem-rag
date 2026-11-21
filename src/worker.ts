import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { extractPage } from "./ingest/extract-page.js";
import { fetchPage } from "./ingest/fetch-page.js";
import {
  ingestMessageSchema,
  type IngestMessage,
} from "./ingest/ingest-message.js";
import { sqsClient } from "./queue/sqs-client.js";
import { SqsQueue } from "./queue/sqs-queue.js";

export async function handler(
  queue: Pick<SqsQueue<IngestMessage>, "receive" | "parse" | "ack">,
) {
  const [message] = await queue.receive({ maxMessages: 1 });

  if (!message) {
    console.log("No new message.");
    return;
  }

  const ingestMessage = queue.parse(message);
  console.log(`Processing message ${ingestMessage.traceId}.`);

  const page = await fetchPage(ingestMessage.url);
  console.log(`Page ${ingestMessage.traceId} downloaded.`);

  const extractedPage = extractPage(page);
  console.log(`Page ${ingestMessage.traceId} extracted.`);

  try {
    await queue.ack(message);
  } catch (err) {
    throw new Error(
      `Failed to remove message ${ingestMessage.traceId} from queue.`,
      { cause: err },
    );
  }

  console.log(`Message ${ingestMessage.traceId} removed from queue.`);
}

async function main() {
  const queue = new SqsQueue(sqsClient, env.SQS_QUEUE_URL, ingestMessageSchema);
  await handler(queue);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

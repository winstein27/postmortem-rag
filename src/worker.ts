import type { Message } from "@aws-sdk/client-sqs";
import { setTimeout } from "node:timers/promises";
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
  queue: Pick<SqsQueue<IngestMessage>, "parse" | "ack">,
  message: Message,
) {
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

export async function getMessage(
  queue: Pick<SqsQueue<IngestMessage>, "receive">,
  signal: AbortSignal,
): Promise<Message | undefined> {
  const [message] = await queue.receive({ maxMessages: 1, signal });

  if (!message) {
    console.log("No new message.");
    return;
  }

  return message;
}

export async function runWorker(
  queue: Pick<SqsQueue<IngestMessage>, "receive" | "parse" | "ack">,
  {
    signal,
    sleep,
  }: {
    signal: AbortSignal;
    sleep: typeof setTimeout;
  },
): Promise<void> {
  let errorWaitTime = 1_000;
  while (!signal.aborted) {
    let message: Message | undefined;

    try {
      message = await getMessage(queue, signal);
      errorWaitTime = 1_000;
    } catch (err) {
      if (signal.aborted) return;

      console.error(
        `Failed to receive from the queue, retrying in ${errorWaitTime} ms:`,
        err,
      );

      await sleep(errorWaitTime, undefined, { signal }).catch(() => undefined);

      errorWaitTime = Math.min(errorWaitTime * 2, 30_000);
    }

    if (!message) {
      continue;
    }

    try {
      await handler(queue, message);
    } catch (err) {
      console.error(`Error processing message:\n`, err);
    }
  }
}

async function main() {
  const queue = new SqsQueue(sqsClient, env.SQS_QUEUE_URL, ingestMessageSchema);

  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());

  await runWorker(queue, { signal: controller.signal, sleep: setTimeout });

  console.log("Worker stopped.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

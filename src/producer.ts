import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import type { IngestMessage } from "./ingest/ingest-message.js";
import { IngestPublisher } from "./ingest/ingest-publisher.js";
import { parseUrlList } from "./ingest/parse-url-list.js";
import { sqsClient } from "./queue/sqs-client.js";
import { SqsQueue } from "./queue/sqs-queue.js";

export async function produce(
  publisher: Pick<IngestPublisher, "publish">,
  text: string,
): Promise<void> {
  // parse urls
  const urls = parseUrlList(text);

  // publish messages
  for (const url of urls.validUrls) {
    await publisher.publish(url);
  }

  console.log(`Published ${urls.validUrls.length} messages.`);

  if (urls.invalidUrls.length > 0) {
    console.warn(`${urls.invalidUrls.length} invalid urls not published:`);

    for (const invalidUrl of urls.invalidUrls) {
      console.warn(`\tskipped invalid URL: ${invalidUrl}`);
    }
  }
}

async function main() {
  // create queue and publisher
  const queue = new SqsQueue<IngestMessage>(sqsClient, env.SQS_QUEUE_URL);
  const publisher = new IngestPublisher(queue);

  // read file
  const filePath = path.resolve("data/urls.txt");
  const data = await readFile(filePath);

  // publish
  await produce(publisher, data.toString());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}

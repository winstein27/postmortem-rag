import {
  createIngestMessage,
  type IngestMessage,
} from "./ingest/ingest-message.js";
import type { SqsQueue } from "./queue/sqs-queue.js";

export class IngestPublisher {
  constructor(private readonly queue: Pick<SqsQueue<IngestMessage>, "send">) {}

  async publish(url: string) {
    const message = createIngestMessage(url);
    await this.queue.send(message);
  }
}

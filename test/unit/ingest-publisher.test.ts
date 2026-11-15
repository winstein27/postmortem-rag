import assert from "node:assert/strict";
import { beforeEach, describe, it, mock, type Mock } from "node:test";
import { ZodError } from "zod";
import {
  ingestMessageSchema,
  type IngestMessage,
} from "../../src/ingest/ingest-message.js";
import { IngestPublisher } from "../../src/ingest/ingest-publisher.js";
import { type SqsQueue } from "../../src/queue/sqs-queue.js";

describe("ingest publisher", () => {
  let publisher: IngestPublisher;
  let queue: { send: Mock<SqsQueue<IngestMessage>["send"]> };

  beforeEach(() => {
    queue = {
      send: mock.fn(async () => undefined),
    };

    publisher = new IngestPublisher(queue);
  });

  it("queues a valid message", async () => {
    await publisher.publish("http://test.com");

    assert.equal(queue.send.mock.callCount(), 1);
    assert.ok(
      ingestMessageSchema.parse(queue.send.mock.calls[0]?.arguments[0]),
    );
  });

  it("throws on invalid URL", async () => {
    await assert.rejects(() => publisher.publish("test"), ZodError);
    assert.equal(queue.send.mock.callCount(), 0);
  });
});

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import { SqsQueue } from "../../src/queue/sqs-queue.js";

const QUEUE_URL = "http://sqs.local/000000000000/q";

/** Fake client that records the commands it receives and answers with the handler. */
function fakeClient(handler: (cmd: object) => unknown) {
  const calls: object[] = [];
  const client = {
    send: async (cmd: object) => {
      calls.push(cmd);
      return handler(cmd);
    },
  } as unknown as SQSClient;
  return { client, calls };
}

const defaultHandler = (cmd: object) => {
  if (cmd instanceof SendMessageCommand) return { MessageId: "msg-1" };
  return {};
};

describe("SqsQueue", () => {
  let fake: ReturnType<typeof fakeClient>;
  beforeEach(() => {
    fake = fakeClient(defaultHandler);
  });

  it("send serializes the body as JSON", async () => {
    const queue = new SqsQueue<{ url: string }>(fake.client, QUEUE_URL);
    assert.equal(await queue.send({ url: "https://a" }), "msg-1");
    const cmd = fake.calls.find((c) => c instanceof SendMessageCommand) as SendMessageCommand;
    assert.deepEqual(cmd.input, { QueueUrl: QUEUE_URL, MessageBody: '{"url":"https://a"}' });
  });

  it("receive uses long polling and the maximum batch size by default", async () => {
    const queue = new SqsQueue(fake.client, QUEUE_URL);
    assert.deepEqual(await queue.receive(), []);
    const cmd = fake.calls.find((c) => c instanceof ReceiveMessageCommand) as ReceiveMessageCommand;
    assert.deepEqual(cmd.input, { QueueUrl: QUEUE_URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 });
  });

  it("receive passes through the given options", async () => {
    const queue = new SqsQueue(fake.client, QUEUE_URL);
    await queue.receive({ maxMessages: 1, waitTimeSeconds: 0, visibilityTimeoutSeconds: 5 });
    const cmd = fake.calls.find((c) => c instanceof ReceiveMessageCommand) as ReceiveMessageCommand;
    assert.deepEqual(cmd.input, {
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 0,
      VisibilityTimeout: 5,
    });
  });

  it("ack deletes the message by ReceiptHandle", async () => {
    const queue = new SqsQueue(fake.client, QUEUE_URL);
    await queue.ack({ ReceiptHandle: "rh-1" });
    const cmd = fake.calls.find((c) => c instanceof DeleteMessageCommand) as DeleteMessageCommand;
    assert.deepEqual(cmd.input, { QueueUrl: QUEUE_URL, ReceiptHandle: "rh-1" });
  });

  it("ack ignores a message without a ReceiptHandle", async () => {
    const queue = new SqsQueue(fake.client, QUEUE_URL);
    await queue.ack({});
    assert.equal(fake.calls.length, 0);
  });

  it("parse deserializes the body", () => {
    const queue = new SqsQueue<{ url: string }>(fake.client, QUEUE_URL);
    assert.deepEqual(queue.parse({ Body: '{"url":"https://a"}' }), { url: "https://a" });
  });
});

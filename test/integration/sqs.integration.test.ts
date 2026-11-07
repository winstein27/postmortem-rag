// Requires `npm run infra:up` (ElasticMQ on localhost:9324)
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
} from "@aws-sdk/client-sqs";
import { env } from "../../src/config/env.js";
import { createSqsClient } from "../../src/queue/sqs-client.js";
import { SqsQueue } from "../../src/queue/sqs-queue.js";

const client = createSqsClient(env);
const created: string[] = [];

async function createQueue(name: string, attributes?: Record<string, string>): Promise<string> {
  const { QueueUrl } = await client.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }));
  assert.ok(QueueUrl);
  created.push(QueueUrl);
  return QueueUrl;
}

async function queueArn(url: string): Promise<string> {
  const { Attributes } = await client.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ["QueueArn"] }),
  );
  assert.ok(Attributes?.QueueArn);
  return Attributes.QueueArn;
}

after(async () => {
  await Promise.all(created.map((QueueUrl) => client.send(new DeleteQueueCommand({ QueueUrl }))));
  client.destroy();
});

describe("ElasticMQ provisioned by docker compose", () => {
  it("creates the ingest queue with a redrive policy to the DLQ", async () => {
    const { Attributes } = await client.send(
      new GetQueueAttributesCommand({ QueueUrl: env.SQS_QUEUE_URL, AttributeNames: ["RedrivePolicy"] }),
    );
    const policy = JSON.parse(Attributes?.RedrivePolicy ?? "{}");
    assert.match(policy.deadLetterTargetArn, /postmortem-ingest-dlq$/);
    assert.equal(Number(policy.maxReceiveCount), 3);
  });
});

describe("SqsQueue against ElasticMQ", () => {
  let url: string;
  before(async () => {
    url = await createQueue(`test-${randomUUID()}`);
  });

  it("sends, receives, and acks a message", async () => {
    const queue = new SqsQueue<{ url: string }>(client, url);
    const payload = { url: "https://blog.cloudflare.com/example" };

    const id = await queue.send(payload);
    assert.ok(id);

    const [msg, ...rest] = await queue.receive({ waitTimeSeconds: 2 });
    assert.ok(msg);
    assert.equal(rest.length, 0);
    assert.equal(msg.MessageId, id);
    assert.deepEqual(queue.parse(msg), payload);

    await queue.ack(msg);
    // Even with a zero visibility timeout, the message does not come back after the ack
    assert.deepEqual(await queue.receive({ waitTimeSeconds: 1, visibilityTimeoutSeconds: 0 }), []);
  });

  it("returns the message to the queue when it is not acked", async () => {
    const queue = new SqsQueue<{ n: number }>(client, url);
    await queue.send({ n: 1 });
    const [first] = await queue.receive({ waitTimeSeconds: 2, visibilityTimeoutSeconds: 1 });
    assert.ok(first);
    const [again] = await queue.receive({ waitTimeSeconds: 5 });
    assert.ok(again);
    assert.equal(again.MessageId, first.MessageId);
    await queue.ack(again);
  });
});

describe("Dead-letter queue", () => {
  it("moves the message to the DLQ after maxReceiveCount is exceeded", async () => {
    const suffix = randomUUID();
    const dlqUrl = await createQueue(`test-dlq-${suffix}`);
    const mainUrl = await createQueue(`test-main-${suffix}`, {
      RedrivePolicy: JSON.stringify({ deadLetterTargetArn: await queueArn(dlqUrl), maxReceiveCount: "2" }),
    });

    const main = new SqsQueue<{ boom: boolean }>(client, mainUrl);
    const id = await main.send({ boom: true });

    // Receive without acking until the delivery limit is reached
    for (let i = 0; i < 2; i++) {
      const [msg] = await main.receive({ waitTimeSeconds: 2, visibilityTimeoutSeconds: 0 });
      assert.ok(msg, `delivery ${i + 1} should happen`);
    }
    assert.deepEqual(await main.receive({ waitTimeSeconds: 1, visibilityTimeoutSeconds: 0 }), []);

    const dlq = new SqsQueue<{ boom: boolean }>(client, dlqUrl);
    const [dead] = await dlq.receive({ waitTimeSeconds: 2 });
    assert.ok(dead);
    assert.equal(dead.MessageId, id);
    assert.deepEqual(dlq.parse(dead), { boom: true });
  });
});

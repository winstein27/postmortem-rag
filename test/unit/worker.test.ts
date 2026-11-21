import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
  mock,
  type Mock,
} from "node:test";
import { ingestMessageSchema } from "../../src/ingest/ingest-message.js";
import { SqsQueue } from "../../src/queue/sqs-queue.js";
import { getMessage, handler } from "../../src/worker.js";

const QUEUE_URL = "http://sqs.local/000000000000/postmortem-ingest";
const RECEIPT_HANDLE = "receipt-1";
// The message schema requires a hostname with a domain, so messages carry this
// host and fetch is redirected to the local test server.
const POSTMORTEM_ORIGIN = "https://blog.example.com";

// Synthetic HTML that mirrors the Cloudflare blog layout. No real postmortem text.
const ARTICLE_HTML = `<!doctype html><html><head>
  <script type="application/ld+json">{"@type":"BlogPosting","headline":"Widget outage on March 3, 2025","datePublished":"2025-03-04T10:00:00.000Z"}</script>
</head><body><article>
  <h1>Widget outage on March 3, 2025</h1>
  <div class="article-content"><p>Intro.</p><h2>Cause</h2><p>A widget failed.</p></div>
</article></body></html>`;

// Has a title and a date, but no article body.
const NOT_AN_ARTICLE_HTML = `<!doctype html><html><head>
  <meta property="article:published_time" content="2025-03-04T10:00:00.000Z">
</head><body><h1>Not a post</h1><p>Some page text.</p></body></html>`;

/**
 * Real SqsQueue over a fake SQS client. The fake answers ReceiveMessage with
 * the given messages and records every command, so a test can check whether
 * the message was deleted.
 */
function fakeQueue(
  messages: Message[] = [],
  options: { failDelete?: boolean } = {},
) {
  const commands: object[] = [];
  const client = {
    send: async (command: object) => {
      commands.push(command);
      if (command instanceof ReceiveMessageCommand) {
        return { Messages: messages };
      }
      if (command instanceof DeleteMessageCommand && options.failDelete) {
        throw new Error("Delete failed");
      }
      return {};
    },
  } as unknown as SQSClient;

  return {
    queue: new SqsQueue(client, QUEUE_URL, ingestMessageSchema),
    commands,
    deletes: () =>
      commands.filter((command) => command instanceof DeleteMessageCommand),
  };
}

function message(body: unknown): Message {
  return {
    MessageId: "message-1",
    ReceiptHandle: RECEIPT_HANDLE,
    Body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

describe("worker getMessage", () => {
  let log: Mock<typeof console.log>;

  beforeEach(() => {
    log = mock.method(console, "log", () => {});
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("receives one message at a time and returns it", async () => {
    const received = message({ url: "https://blog.example.com/post" });
    const fake = fakeQueue([received]);

    const result = await getMessage(fake.queue);

    assert.equal(result, received);
    const receives = fake.commands.filter(
      (command) => command instanceof ReceiveMessageCommand,
    );
    assert.equal(receives.length, 1);
    assert.equal(receives[0]?.input.MaxNumberOfMessages, 1);
  });

  it("returns undefined and logs when the queue is empty", async () => {
    const fake = fakeQueue([]);

    const result = await getMessage(fake.queue);

    assert.equal(result, undefined);
    assert.equal(fake.deletes().length, 0);
    assert.ok(
      log.mock.calls.some((call) =>
        String(call.arguments[0]).includes("No new message."),
      ),
    );
  });
});

describe("worker handler", () => {
  let server: Server;
  let baseUrl: string;
  let requests: string[];
  let log: Mock<typeof console.log>;
  const realFetch = globalThis.fetch;

  before(async () => {
    server = createServer((req, res) => {
      requests.push(req.url ?? "");
      const html = { "content-type": "text/html; charset=utf-8" };
      if (req.url === "/article") {
        res.writeHead(200, html);
        res.end(ARTICLE_HTML);
      } else if (req.url === "/not-an-article") {
        res.writeHead(200, html);
        res.end(NOT_AN_ARTICLE_HTML);
      } else if (req.url === "/server-error") {
        res.writeHead(500, html);
        res.end("error");
      } else {
        res.writeHead(404, html);
        res.end("not found");
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(() => {
    server.close();
  });

  beforeEach(() => {
    requests = [];
    // The handler logs each step; keep the test output clean.
    log = mock.method(console, "log", () => {});
    mock.method(
      globalThis,
      "fetch",
      (input: string | URL | Request, init?: RequestInit) =>
        realFetch(String(input).replace(POSTMORTEM_ORIGIN, baseUrl), init),
    );
  });

  afterEach(() => {
    mock.restoreAll();
  });

  function ingestBody(path: string) {
    return { url: `${POSTMORTEM_ORIGIN}${path}`, traceId: randomUUID() };
  }

  describe("parse errors", () => {
    it("rejects a body that is not JSON and keeps the message", async () => {
      const msg = message("not json");
      const fake = fakeQueue();

      await assert.rejects(handler(fake.queue, msg), SyntaxError);

      assert.equal(fake.deletes().length, 0);
      assert.deepEqual(requests, []);
    });

    it("rejects a body that does not match the schema and keeps the message", async () => {
      const msg = message({ url: "ftp://example.com/post" });
      const fake = fakeQueue();

      await assert.rejects(handler(fake.queue, msg), { name: "ZodError" });

      assert.equal(fake.deletes().length, 0);
      assert.deepEqual(requests, []);
    });
  });

  describe("fetch errors", () => {
    it("rejects a non-2xx response and keeps the message", async () => {
      const msg = message(ingestBody("/server-error"));
      const fake = fakeQueue();

      await assert.rejects(handler(fake.queue, msg), /HTTP: 500/);

      assert.equal(fake.deletes().length, 0);
      assert.deepEqual(requests, ["/server-error"]);
    });

    it("rejects a page that does not exist and keeps the message", async () => {
      const msg = message(ingestBody("/missing"));
      const fake = fakeQueue();

      await assert.rejects(handler(fake.queue, msg), /HTTP: 404/);

      assert.equal(fake.deletes().length, 0);
    });
  });

  describe("extraction errors", () => {
    it("rejects a page that is not a blog post and keeps the message", async () => {
      const msg = message(ingestBody("/not-an-article"));
      const fake = fakeQueue();

      await assert.rejects(handler(fake.queue, msg), /article-content/);

      assert.equal(fake.deletes().length, 0);
      assert.deepEqual(requests, ["/not-an-article"]);
    });
  });

  describe("success", () => {
    it("downloads and extracts the page, then deletes the message", async () => {
      const msg = message(ingestBody("/article"));
      const fake = fakeQueue();

      await handler(fake.queue, msg);

      assert.deepEqual(requests, ["/article"]);
      const deletes = fake.deletes();
      assert.equal(deletes.length, 1);
      assert.equal(deletes[0]?.input.ReceiptHandle, RECEIPT_HANDLE);
      assert.equal(deletes[0]?.input.QueueUrl, QUEUE_URL);
      assert.ok(logged("removed from queue"));
    });
  });

  describe("ack errors", () => {
    it("wraps a failed delete with the trace ID and does not report the message as removed", async () => {
      const body = ingestBody("/article");
      const msg = message(body);
      const fake = fakeQueue([], { failDelete: true });

      await assert.rejects(
        handler(fake.queue, msg),
        ackError(body.traceId, /Delete failed/),
      );

      assert.equal(fake.deletes().length, 1);
      assert.equal(logged("removed from queue"), false);
    });

    it("wraps a missing receipt handle with the trace ID and does not report the message as removed", async () => {
      const body = ingestBody("/article");
      const { ReceiptHandle: _, ...withoutHandle } = message(body);
      const fake = fakeQueue();

      await assert.rejects(
        handler(fake.queue, withoutHandle),
        ackError(body.traceId, /no receipt handle/),
      );

      assert.equal(fake.deletes().length, 0);
      assert.equal(logged("removed from queue"), false);
    });
  });

  /** Matches the handler's ack error: its message names the trace ID, and the cause is the original error. */
  function ackError(traceId: string, cause: RegExp) {
    return (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(
        err.message,
        `Failed to remove message ${traceId} from queue.`,
      );
      assert.ok(err.cause instanceof Error);
      assert.match(err.cause.message, cause);
      return true;
    };
  }

  function logged(text: string): boolean {
    return log.mock.calls.some((call) =>
      String(call.arguments[0]).includes(text),
    );
  }
});

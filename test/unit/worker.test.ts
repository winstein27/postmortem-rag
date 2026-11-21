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
import type { setTimeout } from "node:timers/promises";
import { ingestMessageSchema } from "../../src/ingest/ingest-message.js";
import { SqsQueue } from "../../src/queue/sqs-queue.js";
import { getMessage, handler, runWorker } from "../../src/worker.js";

const QUEUE_URL = "http://sqs.local/000000000000/postmortem-ingest";
const RECEIPT_HANDLE = "receipt-message-1";
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
 * the given messages and records every command and its send options, so a
 * test can check whether the message was deleted and what receive was given.
 */
function fakeQueue(
  messages: Message[] = [],
  options: { failDelete?: boolean } = {},
) {
  const commands: object[] = [];
  const sendOptions: unknown[] = [];
  const client = {
    send: async (command: object, opts?: unknown) => {
      commands.push(command);
      sendOptions.push(opts);
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
    sendOptions,
    deletes: () =>
      commands.filter((command) => command instanceof DeleteMessageCommand),
  };
}

/** What one receive does: return messages, or throw an error. */
type ReceiveStep = Message[] | Error | (() => Message[] | Error);

/**
 * Real SqsQueue over a fake SQS client that answers each receive with the
 * next step. When the steps run out, it aborts the controller and returns no
 * messages, so runWorker always stops.
 */
function scriptedQueue(controller: AbortController, steps: ReceiveStep[]) {
  const commands: object[] = [];
  const receiveOptions: unknown[] = [];
  let next = 0;
  const client = {
    send: async (command: object, opts?: unknown) => {
      commands.push(command);
      if (!(command instanceof ReceiveMessageCommand)) {
        return {};
      }
      receiveOptions.push(opts);
      const step = steps[next++];
      if (step === undefined) {
        controller.abort();
        return { Messages: [] };
      }
      const result = typeof step === "function" ? step() : step;
      if (result instanceof Error) {
        throw result;
      }
      return { Messages: result };
    },
  } as unknown as SQSClient;

  return {
    queue: new SqsQueue(client, QUEUE_URL, ingestMessageSchema),
    receiveOptions,
    receives: () => receiveOptions.length,
    deletes: () =>
      commands.filter(
        (command): command is DeleteMessageCommand =>
          command instanceof DeleteMessageCommand,
      ),
  };
}

/**
 * Sleep that does not wait. It records each delay and, like the real one,
 * rejects with an AbortError when the signal is aborted. `onSleep` runs
 * before that check, so a test can abort during the wait.
 */
function fakeSleep(onSleep: () => void = () => {}) {
  const waits: number[] = [];
  const sleep = (async (
    ms: number,
    _value?: unknown,
    options?: { signal?: AbortSignal },
  ) => {
    waits.push(ms);
    onSleep();
    if (options?.signal?.aborted) {
      throw abortError();
    }
  }) as typeof setTimeout;
  return { sleep, waits };
}

/** The error the AWS SDK and node:timers/promises throw when a signal aborts. */
function abortError() {
  return new DOMException("This operation was aborted", "AbortError");
}

function message(body: unknown, id = "message-1"): Message {
  return {
    MessageId: id,
    ReceiptHandle: `receipt-${id}`,
    Body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function ingestBody(path: string) {
  return { url: `${POSTMORTEM_ORIGIN}${path}`, traceId: randomUUID() };
}

let server: Server;
let baseUrl: string;
let requests: string[];
let log: Mock<typeof console.log>;
let logError: Mock<typeof console.error>;
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
});

beforeEach(() => {
  requests = [];
  // The worker logs each step; keep the test output clean.
  log = mock.method(console, "log", () => {});
  logError = mock.method(console, "error", () => {});
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

function logged(text: string): boolean {
  return log.mock.calls.some((call) =>
    String(call.arguments[0]).includes(text),
  );
}

function loggedError(text: string): boolean {
  return logError.mock.calls.some((call) =>
    String(call.arguments[0]).includes(text),
  );
}

describe("worker getMessage", () => {
  it("receives one message at a time with the given signal and returns it", async () => {
    const received = message({ url: "https://blog.example.com/post" });
    const fake = fakeQueue([received]);
    const controller = new AbortController();

    const result = await getMessage(fake.queue, controller.signal);

    assert.equal(result, received);
    const receives = fake.commands.filter(
      (command) => command instanceof ReceiveMessageCommand,
    );
    assert.equal(receives.length, 1);
    assert.equal(receives[0]?.input.MaxNumberOfMessages, 1);
    assert.deepEqual(fake.sendOptions, [{ abortSignal: controller.signal }]);
  });

  it("returns undefined and logs when the queue is empty", async () => {
    const fake = fakeQueue([]);

    const result = await getMessage(fake.queue, new AbortController().signal);

    assert.equal(result, undefined);
    assert.equal(fake.deletes().length, 0);
    assert.ok(logged("No new message."));
  });

  it("propagates a failed receive", async () => {
    const controller = new AbortController();
    const fake = scriptedQueue(controller, [new Error("Connection refused")]);

    await assert.rejects(
      getMessage(fake.queue, controller.signal),
      /Connection refused/,
    );
  });
});

describe("worker handler", () => {
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
});

// If runWorker failed to stop, these tests would hang; the timeout turns that
// into a failure.
describe("worker runWorker", { timeout: 5_000 }, () => {
  describe("polling", () => {
    it("processes a message, then keeps polling after an empty receive", async () => {
      const controller = new AbortController();
      const first = message(ingestBody("/article"), "first");
      const second = message(ingestBody("/article"), "second");
      const fake = scriptedQueue(controller, [[first], [], [second]]);
      const { sleep, waits } = fakeSleep();

      await runWorker(fake.queue, { signal: controller.signal, sleep });

      assert.deepEqual(
        fake.deletes().map((command) => command.input.ReceiptHandle),
        ["receipt-first", "receipt-second"],
      );
      assert.equal(fake.receives(), 4);
      assert.deepEqual(waits, []);
    });

    it("passes the abort signal to every receive", async () => {
      const controller = new AbortController();
      const fake = scriptedQueue(controller, [[], []]);
      const { sleep } = fakeSleep();

      await runWorker(fake.queue, { signal: controller.signal, sleep });

      assert.equal(fake.receives(), 3);
      for (const options of fake.receiveOptions) {
        assert.deepEqual(options, { abortSignal: controller.signal });
      }
    });
  });

  describe("message errors", () => {
    it("logs a failed message, keeps it in the queue, and processes the next one", async () => {
      const controller = new AbortController();
      const bad = message("not json", "bad");
      const good = message(ingestBody("/article"), "good");
      const fake = scriptedQueue(controller, [[bad], [good]]);
      const { sleep, waits } = fakeSleep();

      await runWorker(fake.queue, { signal: controller.signal, sleep });

      assert.deepEqual(
        fake.deletes().map((command) => command.input.ReceiptHandle),
        ["receipt-good"],
      );
      assert.ok(loggedError("Error processing message"));
      // A failed message is not a queue failure, so there is no backoff.
      assert.deepEqual(waits, []);
    });
  });

  describe("receive errors", () => {
    it("logs the error and waits before the next receive", async () => {
      const controller = new AbortController();
      const fake = scriptedQueue(controller, [new Error("Connection refused")]);
      const { sleep, waits } = fakeSleep();

      await runWorker(fake.queue, { signal: controller.signal, sleep });

      assert.ok(loggedError("Failed to receive from the queue"));
      assert.deepEqual(waits, [1_000]);
      assert.equal(fake.receives(), 2);
    });

    it("doubles the wait on each consecutive error, up to 30 s", async () => {
      const controller = new AbortController();
      const failures = Array.from({ length: 7 }, () => new Error("Down"));
      const fake = scriptedQueue(controller, failures);
      const { sleep, waits } = fakeSleep();

      await runWorker(fake.queue, { signal: controller.signal, sleep });

      assert.deepEqual(
        waits,
        [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000],
      );
    });

    it("resets the wait after a successful receive", async () => {
      const controller = new AbortController();
      const fake = scriptedQueue(controller, [
        new Error("Down"),
        new Error("Down"),
        [],
        new Error("Down"),
      ]);
      const { sleep, waits } = fakeSleep();

      await runWorker(fake.queue, { signal: controller.signal, sleep });

      assert.deepEqual(waits, [1_000, 2_000, 1_000]);
    });
  });

  describe("shutdown", () => {
    it("does not receive when the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const fake = scriptedQueue(controller, [
        [message(ingestBody("/article"))],
      ]);
      const { sleep } = fakeSleep();

      await runWorker(fake.queue, { signal: controller.signal, sleep });

      assert.equal(fake.receives(), 0);
      assert.deepEqual(requests, []);
    });

    it("finishes and acks the message in progress, then stops", async () => {
      const controller = new AbortController();
      const msg = message(ingestBody("/article"));
      // The signal arrives after the message was received, while it is processed.
      const fake = scriptedQueue(controller, [
        () => {
          controller.abort();
          return [msg];
        },
      ]);
      const { sleep } = fakeSleep();

      await runWorker(fake.queue, { signal: controller.signal, sleep });

      assert.deepEqual(requests, ["/article"]);
      assert.equal(fake.deletes().length, 1);
      assert.equal(fake.receives(), 1);
    });

    it("stops quietly when aborted during a long poll", async () => {
      const controller = new AbortController();
      // Like the SDK: the abort cancels the request and receive rejects.
      const fake = scriptedQueue(controller, [
        () => {
          controller.abort();
          return abortError();
        },
      ]);
      const { sleep, waits } = fakeSleep();

      await runWorker(fake.queue, { signal: controller.signal, sleep });

      assert.equal(fake.receives(), 1);
      assert.deepEqual(waits, []);
      assert.equal(loggedError("Failed to receive from the queue"), false);
    });

    it("stops quietly when aborted during the backoff wait", async () => {
      const controller = new AbortController();
      const fake = scriptedQueue(controller, [new Error("Down")]);
      const { sleep, waits } = fakeSleep(() => controller.abort());

      await runWorker(fake.queue, { signal: controller.signal, sleep });

      assert.deepEqual(waits, [1_000]);
      assert.equal(fake.receives(), 1);
    });
  });
});

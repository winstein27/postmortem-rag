import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { createIngestMessage } from "../../src/ingest/ingest-message.js";

describe("ingest message", () => {
  it("returns a message with URL and UUID trace id", () => {
    const url = "https://url.com";

    const message = createIngestMessage(url);

    assert.equal(message.url, url);
    assert.ok(z.uuid().validate(message.traceId));
  });

  it("throws on a non-HTTP URL", () => {
    assert.throws(() => createIngestMessage("ftp://invalid.com"));
  });

  it("creates a different trace id for each message", () => {
    const message1 = createIngestMessage("http://test.com");
    const message2 = createIngestMessage("http://test.com");

    assert.notEqual(message1.traceId, message2.traceId);
  });
});

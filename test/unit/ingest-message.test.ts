import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uuid } from "zod";
import { createIngestMessage } from "../../src/ingest/ingest-message.js";

describe("ingest message", () => {
  it("should return valid url and uuid object", () => {
    const url = "https://url.com";

    const message = createIngestMessage(url);

    assert.equal(message.url, url);
    assert.ok(uuid().validate(message.traceId));
  });

  it("should throw when url is invalid", () => {
    assert.throws(() => createIngestMessage("ftp://invalid.com"));
  });

  it("should create different traceId for different messages", () => {
    const message1 = createIngestMessage("http://test.com");
    const message2 = createIngestMessage("http://test.com");

    assert.notEqual(message1.traceId, message2.traceId);
  });
});

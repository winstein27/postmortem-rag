import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ingestMessage } from "../../src/queue/ingest-message.js";
import z from "zod";

describe("ingest message", () => {
  it("should return an url and uuid object", () => {
    const url = "url";
    const urlSchema = z.uuid();

    const message = ingestMessage(url);

    const result = urlSchema.safeParse(message.traceId);

    assert.equal(message.url, url);
    assert.equal(result.success, true);
  });
});

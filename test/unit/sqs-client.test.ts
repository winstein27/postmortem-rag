import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSqsClient } from "../../src/queue/sqs-client.js";

describe("createSqsClient", () => {
  it("uses the custom endpoint when SQS_ENDPOINT is set", async () => {
    const client = createSqsClient({ AWS_REGION: "us-east-1", SQS_ENDPOINT: "http://localhost:9324" });
    const endpoint = await client.config.endpoint?.();
    assert.equal(endpoint?.hostname, "localhost");
    assert.equal(endpoint?.port, 9324);
    assert.equal(endpoint?.protocol, "http:");
    client.destroy();
  });

  it("does not set an endpoint in production (the SDK resolves the AWS endpoint)", async () => {
    const client = createSqsClient({ AWS_REGION: "sa-east-1", SQS_ENDPOINT: undefined });
    assert.equal(client.config.endpoint, undefined);
    assert.equal(await client.config.region(), "sa-east-1");
    client.destroy();
  });
});

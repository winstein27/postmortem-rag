import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "../../src/config/env.js";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  SQS_QUEUE_URL: "http://localhost:9324/000000000000/postmortem-ingest",
};

describe("parseEnv", () => {
  it("accepts the minimal configuration and applies defaults", () => {
    const env = parseEnv(base);
    assert.equal(env.AWS_REGION, "us-east-1");
    assert.equal(env.NODE_ENV, "development");
    assert.equal(env.SQS_ENDPOINT, undefined);
  });

  it("keeps SQS_ENDPOINT when set (local ElasticMQ)", () => {
    const env = parseEnv({ ...base, SQS_ENDPOINT: "http://localhost:9324" });
    assert.equal(env.SQS_ENDPOINT, "http://localhost:9324");
  });

  it("treats an empty SQS_ENDPOINT as unset (production)", () => {
    const env = parseEnv({ ...base, SQS_ENDPOINT: "" });
    assert.equal(env.SQS_ENDPOINT, undefined);
  });

  it("rejects an invalid SQS_ENDPOINT", () => {
    assert.throws(() => parseEnv({ ...base, SQS_ENDPOINT: "not-a-url" }));
  });

  it("rejects an invalid SQS_QUEUE_URL", () => {
    assert.throws(() => parseEnv({ ...base, SQS_QUEUE_URL: "postmortem-ingest" }));
  });

  it("requires DATABASE_URL and SQS_QUEUE_URL", () => {
    assert.throws(() => parseEnv({ SQS_QUEUE_URL: base.SQS_QUEUE_URL }));
    assert.throws(() => parseEnv({ DATABASE_URL: base.DATABASE_URL }));
  });
});

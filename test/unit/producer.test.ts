import assert from "node:assert/strict";
import { beforeEach, describe, it, mock, type Mock } from "node:test";
import type { IngestPublisher } from "../../src/ingest/ingest-publisher.js";
import { produce } from "../../src/producer.js";

describe("producer", () => {
  let publisher: { publish: Mock<IngestPublisher["publish"]> };

  beforeEach(() => {
    publisher = {
      publish: mock.fn(async () => undefined),
    };
  });

  it("publishes a message at a time", async () => {
    const textFile = "# comment 1\nhttps://test.com\nhttp://test2.com\n";

    await produce(publisher, textFile);

    const publishMock = publisher.publish.mock;

    assert.equal(publishMock.callCount(), 2);
    assert.equal(publishMock.calls[0]?.arguments[0], "https://test.com/");
    assert.equal(publishMock.calls[1]?.arguments[0], "http://test2.com/");
  });

  it("does not publish invalid urls", async () => {
    const textFile = "https://invalid\nhttp://valid.com\n";

    await produce(publisher, textFile);

    const publishMock = publisher.publish.mock;

    assert.equal(publishMock.callCount(), 1);
    assert.equal(publishMock.calls[0]?.arguments[0], "http://valid.com/");
  });

  it("rejects and stops when a publish fails", async () => {
    const textFile =
      "# comment 1\nhttps://test.com\nhttp://test2.com/\nhttp://test3.com/\n";

    const publishMock = publisher.publish.mock;
    publishMock.mockImplementation(async (url: string) => {
      if (url === "http://test2.com/") throw new Error();
    });

    await assert.rejects(() => produce(publisher, textFile), Error);
    assert.equal(publishMock.callCount(), 2);
  });
});

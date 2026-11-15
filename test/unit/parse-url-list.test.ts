import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUrlList } from "../../src/ingest/parse-url-list.js";

describe("parseUrlList", () => {
  it("ignores lines starting with #", () => {
    const urlList = parseUrlList("# comment\n#comment");
    assert.equal(urlList.validUrls.length, 0);
  });

  it("returns valid URL", () => {
    const urlList = parseUrlList("# comment\n#comment\nhttps://test.com/");
    assert.equal(urlList.validUrls.length, 1);
    assert.equal(urlList.validUrls[0], "https://test.com/");
    assert.equal(urlList.invalidUrls.length, 0);
  });

  it("ignores empty lines", () => {
    const urlList = parseUrlList("# comment\n#comment\n\nhttps://test.com/");
    assert.equal(urlList.validUrls.length, 1);
    assert.equal(urlList.validUrls[0], "https://test.com/");
    assert.equal(urlList.invalidUrls.length, 0);
  });

  it("ignores lines of spaces", () => {
    const urlList = parseUrlList(
      "# comment\n#comment\n    \nhttps://test.com/",
    );
    assert.equal(urlList.validUrls.length, 1);
    assert.equal(urlList.validUrls[0], "https://test.com/");
    assert.equal(urlList.invalidUrls.length, 0);
  });

  it("returns valid list of URLs", () => {
    const urlList = parseUrlList(
      "#comment\nhttps://test.com/\nhttps://a.com/\nhttps://b.com/\n",
    );
    assert.equal(urlList.validUrls.length, 3);
    assert.deepEqual(urlList.validUrls, [
      "https://test.com/",
      "https://a.com/",
      "https://b.com/",
    ]);
    assert.equal(urlList.invalidUrls.length, 0);
  });

  it("trims whitespace around URLs", () => {
    const urlList = parseUrlList("# comment\n#comment\n\n https://test.com/ ");
    assert.equal(urlList.validUrls.length, 1);
    assert.equal(urlList.validUrls[0], "https://test.com/");
    assert.equal(urlList.invalidUrls.length, 0);
  });

  it("removes duplicates", () => {
    const urlList = parseUrlList(
      "# comment\n#comment\n\n https://test.com/ \nhttps://test.com/",
    );
    assert.equal(urlList.validUrls.length, 1);
    assert.equal(urlList.validUrls[0], "https://test.com/");
    assert.equal(urlList.invalidUrls.length, 0);
  });

  it("deduplicates URLs that normalize to the same value", () => {
    const urlList = parseUrlList(
      "# comment\n#comment\n\n https://test.com/ \nhttps://test.com",
    );
    assert.equal(urlList.validUrls.length, 1);
    assert.equal(urlList.validUrls[0], "https://test.com/");
    assert.equal(urlList.invalidUrls.length, 0);
  });

  it("returns invalid URLs", () => {
    const urlList = parseUrlList(
      "# comment\n#comment\n\n https://test.com/ \nhttps://test/invalid\nftp://test.com",
    );

    assert.equal(urlList.validUrls.length, 1);
    assert.equal(urlList.validUrls[0], "https://test.com/");
    assert.equal(urlList.invalidUrls.length, 2);
    assert.equal(urlList.invalidUrls[0], "https://test/invalid");
    assert.equal(urlList.invalidUrls[1], "ftp://test.com");
  });
});

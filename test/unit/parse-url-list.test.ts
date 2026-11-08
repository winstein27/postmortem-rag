import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUrlList } from "../../src/ingest/parse-url-list.js";

describe("parseUrlList", () => {
  it("ignores lines starting with #", () => {
    const urlList = parseUrlList("# comment\n#comment");
    assert.equal(urlList.length, 0);
  });

  it("returns valid URL", () => {
    const urlList = parseUrlList("# comment\n#comment\nhttps://test.com/");
    assert.equal(urlList.length, 1);
    assert.equal(urlList[0], "https://test.com/");
  });

  it("ignores empty lines", () => {
    const urlList = parseUrlList("# comment\n#comment\n\nhttps://test.com/");
    assert.equal(urlList.length, 1);
    assert.equal(urlList[0], "https://test.com/");
  });

  it("ignores lines of spaces", () => {
    const urlList = parseUrlList(
      "# comment\n#comment\n    \nhttps://test.com/",
    );
    assert.equal(urlList.length, 1);
    assert.equal(urlList[0], "https://test.com/");
  });

  it("returns valid list of URLs", () => {
    const urlList = parseUrlList(
      "#comment\nhttps://test.com/\nhttps://a.com/\nhttps://b.com/\n",
    );
    assert.equal(urlList.length, 3);
    assert.deepEqual(urlList, [
      "https://test.com/",
      "https://a.com/",
      "https://b.com/",
    ]);
  });

  it("trims whitespace around URLs", () => {
    const urlList = parseUrlList("# comment\n#comment\n\n https://test.com/ ");
    assert.equal(urlList.length, 1);
    assert.equal(urlList[0], "https://test.com/");
  });

  it("removes duplicates", () => {
    const urlList = parseUrlList(
      "# comment\n#comment\n\n https://test.com/ \nhttps://test.com/",
    );
    assert.equal(urlList.length, 1);
    assert.equal(urlList[0], "https://test.com/");
  });

  it("throws on an invalid URL", () => {
    assert.throws(
      () =>
        parseUrlList(
          "# comment\n#comment\n\n https://test.com/ \nhttps://test./",
        ),
      { message: "invalid url: https://test./" },
    );
  });

  it("throws when protocol is not http(s)", () => {
    assert.throws(
      () => parseUrlList("# comment\n#comment\n\n ftp://test.com/"),
      { message: "invalid url: ftp://test.com/" },
    );
  });

  it("deduplicates URLs that normalize to the same value", () => {
    const urlList = parseUrlList(
      "# comment\n#comment\n\n https://test.com/ \nhttps://test.com",
    );
    assert.equal(urlList.length, 1);
    assert.equal(urlList[0], "https://test.com/");
  });
});

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { fetchPage } from "../../src/ingest/fetch-page.js";

describe("fetch page", () => {
  let server: Server;
  let baseUrl: string;
  const html = "<html><body>postmortem</body></html>";
  const headers = { "content-type": "text/html; charset=utf-8" };

  before(async () => {
    server = createServer(async (req, res) => {
      if (req.url === "/ok") {
        res.writeHead(200, headers);
        res.end(html);
      } else if (req.url === "/timeout") {
        return;
      } else if (req.url === "/err") {
        res.writeHead(500, headers);
        res.end(html);
      } else if (req.url === "/json") {
        res.writeHead(200, {
          "content-type": "application/json",
        });
        res.end(JSON.stringify({ name: "Jhon", age: 32 }));
      } else {
        res.writeHead(404, headers);
        res.end(html);
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    baseUrl = `http://localhost:${port}`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  it("returns page for valid url", async () => {
    const text = await fetchPage(`${baseUrl}/ok`);
    assert.equal(text, html);
  });

  it("throws on timeout", async () => {
    await assert.rejects(() => fetchPage(`${baseUrl}/timeout`, 50), {
      name: "TimeoutError",
    });
  });

  it("throws on non-2XX response", async () => {
    await assert.rejects(
      () => fetchPage(`${baseUrl}/err`),
      (err: Error) => {
        assert.equal(err.name, "Error");
        assert.ok(err.message.includes("Failed to fetch"));
        assert.ok(err.message.includes("500"));
        return true;
      },
    );
  });

  it("throws on non-HTML content type", async () => {
    await assert.rejects(
      () => fetchPage(`${baseUrl}/json`),
      (err: Error) => {
        assert.equal(err.name, "Error");
        assert.ok(err.message.includes("Unexpected content type"));
        assert.ok(!err.message.includes("text/html"));
        return true;
      },
    );
  });

  it("throws on unknown URL", async () => {
    await assert.rejects(
      () => fetchPage(`${baseUrl}/abc`),
      (err: Error) => {
        assert.equal(err.name, "Error");
        assert.ok(err.message.includes("Failed to fetch"));
        assert.ok(err.message.includes("404"));
        return true;
      },
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractPage,
  parseIncidentDate,
} from "../../src/ingest/extract-page.js";

// Synthetic HTML that mirrors the Cloudflare blog layout. No real postmortem text.
interface PageOptions {
  jsonLd?: string;
  meta?: string;
  time?: string;
  h1?: string;
  body?: string | null;
}

const defaultBody = `
  <p>Intro paragraph one.</p>
  <p>Intro <a href="#">with a link</a> and<br>a line break.</p>
  <h2>What happened</h2>
  <p>A    widget   failed.</p>
  <figure class="emdash-image"><img src="x.png"><figcaption>Error rate chart</figcaption></figure>
  <figure class="emdash-image"><img src="y.png"></figure>
  <h3>The root cause</h3>
  <ul><li>First   item</li><li>Second item</li></ul>
  <div class="emdash-code"><pre><code>config {
  enabled: true
}
</code></pre><button>Copy</button></div>
  <script>console.log("tracking")</script>
  <h2>Timeline</h2>
  <div class="emdash-table-wrapper"><table>
    <thead><tr><th>Time (UTC)</th><th>Event</th></tr></thead>
    <tbody><tr><td>10:00</td><td>Change deployed</td></tr></tbody>
  </table></div>
`;

function page(options: PageOptions = {}): string {
  const {
    jsonLd = `{"@type":"BlogPosting","headline":"Widget outage on March 3, 2025","datePublished":"2025-03-04T10:00:00.000Z"}`,
    meta = "",
    time = "March 4, 2025",
    h1 = "Widget outage on March 3, 2025",
    body = defaultBody,
  } = options;

  return `<!doctype html><html><head>
    ${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ""}
    ${meta}
  </head><body>
    <nav><h2>Products</h2><p>Navigation text</p></nav>
    <main><article>
      <time class="date">${time}</time>
      <h1>${h1}</h1>
      <div class="post-layout"><div class="post-content">
        ${body === null ? "" : `<div class="article-content">${body}</div>`}
      </div></div>
      <section class="post-extras"><h2>Related tags</h2><p>Post Mortem</p></section>
      <section class="post-email"><h2>Subscribe to receive notifications</h2></section>
    </article></main>
    <footer><h2>Company</h2><p>Footer text</p></footer>
  </body></html>`;
}

describe("extract page", () => {
  describe("title", () => {
    it("reads the JSON-LD headline", () => {
      assert.equal(extractPage(page()).title, "Widget outage on March 3, 2025");
    });

    it("falls back to og:title, then to the h1", () => {
      const withOg = page({
        jsonLd: "",
        meta: `<meta property="og:title" content="From og">`,
      });
      assert.equal(extractPage(withOg).title, "From og");

      const withH1 = page({ jsonLd: "", h1: "  From   h1 " });
      assert.equal(extractPage(withH1).title, "From h1");
    });

    it("throws when there is no title", () => {
      assert.throws(
        () => extractPage(page({ jsonLd: "", h1: "" })),
        /no title/,
      );
    });
  });

  describe("publish date", () => {
    it("reads JSON-LD datePublished", () => {
      assert.deepEqual(
        extractPage(page()).publishDate,
        new Date("2025-03-04T10:00:00.000Z"),
      );
    });

    it("reads JSON-LD inside an @graph", () => {
      const jsonLd = `{"@graph":[{"@type":"BlogPosting","headline":"Graph post","datePublished":"2025-05-01T00:00:00.000Z"}]}`;
      const result = extractPage(page({ jsonLd }));
      assert.equal(result.title, "Graph post");
      assert.deepEqual(result.publishDate, new Date("2025-05-01T00:00:00.000Z"));
    });

    it("falls back to article:published_time", () => {
      const html = page({
        jsonLd: "",
        meta: `<meta property="article:published_time" content="2025-03-05T08:00:00.000Z">`,
      });
      assert.deepEqual(
        extractPage(html).publishDate,
        new Date("2025-03-05T08:00:00.000Z"),
      );
    });

    it("falls back to the <time> text at UTC midnight", () => {
      const html = page({ jsonLd: "", time: "March 6, 2025" });
      assert.deepEqual(
        extractPage(html).publishDate,
        new Date("2025-03-06T00:00:00.000Z"),
      );
    });

    it("ignores invalid JSON-LD and invalid dates", () => {
      const html = page({
        jsonLd: `{"headline": broken`,
        meta: `<meta property="article:published_time" content="not a date">`,
        time: "March 7, 2025",
      });
      assert.deepEqual(
        extractPage(html).publishDate,
        new Date("2025-03-07T00:00:00.000Z"),
      );
    });

    it("throws when there is no valid publish date", () => {
      const html = page({ jsonLd: "", time: "" });
      assert.throws(() => extractPage(html), /no valid publish date/);
    });
  });

  describe("incident date", () => {
    it("is parsed from the title", () => {
      assert.deepEqual(
        extractPage(page()).incidentDate,
        new Date("2025-03-03T00:00:00.000Z"),
      );
    });

    it("accepts month-first and day-first formats, at UTC midnight", () => {
      const cases: [string, string][] = [
        ["Outage on November 18, 2025", "2025-11-18"],
        ["Service outage June 12 2025", "2025-06-12"],
        ["Outage on 2 July 2019", "2019-07-02"],
        ["outage on january 22, 2026", "2026-01-22"],
      ];
      for (const [title, day] of cases) {
        assert.deepEqual(
          parseIncidentDate(title),
          new Date(`${day}T00:00:00.000Z`),
          title,
        );
      }
    });

    it("is undefined when the title has no date", () => {
      assert.equal(parseIncidentDate("Details of the outage on 1.1.1.1"), undefined);
    });

    it("rejects impossible dates", () => {
      assert.equal(parseIncidentDate("Outage on February 30, 2025"), undefined);
    });
  });

  describe("sections", () => {
    it("splits the article body by h2 and h3, flat, ignoring page chrome", () => {
      const { sections } = extractPage(page());
      assert.deepEqual(
        sections.map((section) => section.title),
        ["Introduction", "What happened", "The root cause", "Timeline"],
      );
    });

    it("puts text before the first heading in an Introduction section", () => {
      const [intro] = extractPage(page()).sections;
      assert.deepEqual(intro, {
        title: "Introduction",
        content:
          "Intro paragraph one.\n\nIntro with a link and a line break.",
      });
    });

    it("collapses whitespace and keeps figure captions only", () => {
      const section = extractPage(page()).sections[1];
      assert.equal(section?.content, "A widget failed.\n\nError rate chart");
    });

    it("renders lists and keeps code whitespace without the copy button", () => {
      const section = extractPage(page()).sections[2];
      assert.equal(
        section?.content,
        "- First item\n- Second item\n\nconfig {\n  enabled: true\n}",
      );
    });

    it("renders tables one row per line", () => {
      const section = extractPage(page()).sections[3];
      assert.equal(
        section?.content,
        "Time (UTC) | Event\n10:00 | Change deployed",
      );
    });

    it("drops headings with no content", () => {
      const body = `<h2>Empty</h2><h3>Child</h3><p>Text.</p>`;
      assert.deepEqual(extractPage(page({ body })).sections, [
        { title: "Child", content: "Text." },
      ]);
    });

    it("returns a single Introduction section when there are no headings", () => {
      const body = `<p>Only text.</p>`;
      assert.deepEqual(extractPage(page({ body })).sections, [
        { title: "Introduction", content: "Only text." },
      ]);
    });

    it("throws when there is no article body", () => {
      assert.throws(
        () => extractPage(page({ body: null })),
        /no \.article-content/,
      );
    });

    it("throws when the article body has no text", () => {
      const body = `<h2>Heading only</h2><figure><img src="x.png"></figure>`;
      assert.throws(() => extractPage(page({ body })), /no text/);
    });
  });

  describe("content", () => {
    it("joins sections as title and text", () => {
      const body = `<p>Intro.</p><h2>Cause</h2><p>Detail.</p>`;
      assert.equal(
        extractPage(page({ body })).content,
        "Introduction\n\nIntro.\n\nCause\n\nDetail.",
      );
    });
  });
});

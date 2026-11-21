import * as cheerio from "cheerio";
import type { ExtractedPage } from "./extracted-page.js";

const INTRODUCTION = "Introduction";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const MONTH_PATTERN = MONTHS.join("|");
// "November 18, 2025" or "November 18 2025"
const MONTH_DAY_YEAR = new RegExp(
  `\\b(${MONTH_PATTERN})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`,
  "i",
);
// "18 November 2025"
const DAY_MONTH_YEAR = new RegExp(
  `\\b(\\d{1,2})\\s+(${MONTH_PATTERN}),?\\s+(\\d{4})\\b`,
  "i",
);

/** Elements that never carry article text. */
const NOISE = "script, style, noscript, button, svg, img, iframe";

type Section = ExtractedPage["sections"][number];
type Selection = ReturnType<cheerio.CheerioAPI>;

/**
 * Extracts a Cloudflare blog postmortem from its HTML.
 *
 * Throws when the page does not look like a blog post (no article body,
 * no title, no publish date, or no text), so a layout change fails loudly
 * instead of storing an empty document.
 */
export function extractPage(html: string): ExtractedPage {
  const $ = cheerio.load(html);
  const jsonLd = readJsonLd($);

  const title = extractTitle($, jsonLd);
  const publishDate = extractPublishDate($, jsonLd);
  const sections = extractSections($);

  if (sections.length === 0) {
    throw new Error("Article body has no text.");
  }

  return {
    title,
    incidentDate: parseIncidentDate(title),
    publishDate,
    sections,
    content: sections
      .map((section) => `${section.title}\n\n${section.content}`)
      .join("\n\n"),
  };
}

/** Finds a date like "November 18, 2025" or "18 November 2025" in a title. */
export function parseIncidentDate(title: string): Date | undefined {
  return findDate(title);
}

function extractTitle(
  $: cheerio.CheerioAPI,
  jsonLd: Record<string, unknown>[],
): string {
  const candidates = [
    ...jsonLd.map((item) => item["headline"]),
    $('meta[property="og:title"]').attr("content"),
    $("h1").first().text(),
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && collapse(candidate) !== "") {
      return collapse(candidate);
    }
  }

  throw new Error("Page has no title.");
}

function extractPublishDate(
  $: cheerio.CheerioAPI,
  jsonLd: Record<string, unknown>[],
): Date {
  const isoCandidates = [
    ...jsonLd.map((item) => item["datePublished"]),
    $('meta[property="article:published_time"]').attr("content"),
  ];

  for (const candidate of isoCandidates) {
    if (typeof candidate === "string") {
      const date = new Date(candidate);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
  }

  const timeText = $("time").first().text();
  const date = findDate(timeText);
  if (date) {
    return date;
  }

  throw new Error("Page has no valid publish date.");
}

function extractSections($: cheerio.CheerioAPI): Section[] {
  const body = $(".article-content").first();
  if (body.length === 0) {
    throw new Error("Page has no .article-content element.");
  }

  body.find(NOISE).remove();
  body.find("br").replaceWith("\n");

  const sections: Section[] = [];
  let current = { title: INTRODUCTION, blocks: [] as string[] };

  const flush = () => {
    if (current.blocks.length > 0) {
      sections.push({
        title: current.title,
        content: current.blocks.join("\n\n"),
      });
    }
  };

  body.children().each((_, element) => {
    const tag = element.tagName.toLowerCase();

    if (tag === "h2" || tag === "h3") {
      flush();
      current = { title: collapse($(element).text()), blocks: [] };
      return;
    }

    const text = renderBlock($, $(element), tag);
    if (text !== "") {
      current.blocks.push(text);
    }
  });
  flush();

  return sections;
}

function renderBlock(
  $: cheerio.CheerioAPI,
  block: Selection,
  tag: string,
): string {
  switch (tag) {
    case "pre":
      return renderPre(block);
    case "table":
      return renderTable($, block);
    case "ul":
    case "ol":
      return block
        .children("li")
        .map((_, item) => `- ${collapse($(item).text())}`)
        .get()
        .join("\n");
    case "figure":
      return collapse(block.find("figcaption").text());
    case "div": {
      // The blog wraps code blocks and tables in divs
      // (div.emdash-code, div.emdash-table-wrapper).
      const pre = block.find("pre").first();
      if (pre.length > 0) {
        return renderPre(pre);
      }
      const table = block.find("table").first();
      if (table.length > 0) {
        return renderTable($, table);
      }
      return collapse(block.text());
    }
    default:
      return collapse(block.text());
  }
}

/** Keeps the whitespace of code: indentation matters in configs and logs. */
function renderPre(pre: Selection): string {
  return pre.text().replace(/^\n+|\s+$/g, "");
}

/** One line per row, cells separated by " | ". */
function renderTable(
  $: cheerio.CheerioAPI,
  table: Selection,
): string {
  return table
    .find("tr")
    .map((_, row) =>
      $(row)
        .children("th, td")
        .map((_, cell) => collapse($(cell).text()))
        .get()
        .join(" | "),
    )
    .get()
    .filter((line) => line.replaceAll("|", "").trim() !== "")
    .join("\n");
}

function readJsonLd($: cheerio.CheerioAPI): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];

  $('script[type="application/ld+json"]').each((_, script) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse($(script).text());
    } catch {
      return;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const candidate of candidates) {
      if (isRecord(candidate)) {
        items.push(candidate);
        if (Array.isArray(candidate["@graph"])) {
          items.push(...candidate["@graph"].filter(isRecord));
        }
      }
    }
  });

  return items;
}

/** Returns the first valid date in the text, at UTC midnight. */
function findDate(text: string): Date | undefined {
  const monthFirst = MONTH_DAY_YEAR.exec(text);
  if (monthFirst) {
    return toUtcDate(monthFirst[3], monthFirst[1], monthFirst[2]);
  }

  const dayFirst = DAY_MONTH_YEAR.exec(text);
  if (dayFirst) {
    return toUtcDate(dayFirst[3], dayFirst[2], dayFirst[1]);
  }

  return undefined;
}

function toUtcDate(
  year: string | undefined,
  monthName: string | undefined,
  day: string | undefined,
): Date | undefined {
  const month = MONTHS.indexOf(monthName?.toLowerCase() ?? "");
  const y = Number(year);
  const d = Number(day);
  if (month === -1 || !Number.isInteger(y) || !Number.isInteger(d)) {
    return undefined;
  }

  const date = new Date(Date.UTC(y, month, d));
  // Rejects overflow such as February 30, which Date.UTC rolls into March.
  if (date.getUTCMonth() !== month || date.getUTCDate() !== d) {
    return undefined;
  }
  return date;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

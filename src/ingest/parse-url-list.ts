import { z } from "zod";

export type ParsedUrlList = {
  validUrls: string[];
  invalidUrls: string[];
};

export function parseUrlList(text: string): ParsedUrlList {
  const validUrls = new Set<string>();
  const invalidUrls = new Set<string>();
  const urlSchema = z.httpUrl({ normalize: true });

  for (const raw of text.split("\n")) {
    const line = raw.trim();

    if (!line.startsWith("#") && line.length > 0) {
      const result = urlSchema.safeParse(line);
      if (result.success) {
        validUrls.add(result.data);
      } else {
        invalidUrls.add(line);
      }
    }
  }

  return { validUrls: [...validUrls], invalidUrls: [...invalidUrls] };
}

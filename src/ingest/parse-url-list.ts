import { z } from "zod";

export function parseUrlList(text: string): string[] {
  const set = new Set<string>();
  const urlSchema = z.httpUrl({ normalize: true });

  for (const raw of text.split("\n")) {
    const line = raw.trim();

    if (!line.startsWith("#") && line.length > 0) {
      const result = urlSchema.safeParse(line);
      if (!result.success) {
        throw new Error(`invalid url: ${line}`);
      }

      set.add(result.data);
    }
  }

  return [...set];
}

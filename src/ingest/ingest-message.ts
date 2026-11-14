import { randomUUID } from "node:crypto";
import { z } from "zod";

export const ingestMessageSchema = z.object({
  url: z.httpUrl(),
  traceId: z.uuid(),
});

export type IngestMessage = z.infer<typeof ingestMessageSchema>;

export function createIngestMessage(url: string): IngestMessage {
  return ingestMessageSchema.parse({ url, traceId: randomUUID() });
}

import { randomUUID } from "node:crypto";
import z from "zod";

export const ingestMessageSchema = z.object({
  url: z.httpUrl(),
  traceId: z.uuid(),
});

export type IngestMessage = z.infer<typeof ingestMessageSchema>;

export function ingestMessage(url: string): IngestMessage {
  return { url, traceId: randomUUID() };
}

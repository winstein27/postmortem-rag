import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  AWS_REGION: z.string().min(1).default("us-east-1"),
  SQS_QUEUE_URL: z.url(),
  /** Set only locally (ElasticMQ). Empty in production, so the SDK uses the AWS endpoint. */
  SQS_ENDPOINT: z.url().optional().or(z.literal("").transform(() => undefined)),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}

export const env: Env = parseEnv(process.env);

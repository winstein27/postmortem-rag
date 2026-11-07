import { SQSClient } from "@aws-sdk/client-sqs";
import { env, type Env } from "../config/env.js";

/**
 * - Production: no custom endpoint; credentials come from the default AWS provider chain (IAM role, env, etc.).
 * - Local: SQS_ENDPOINT points to ElasticMQ, which implements the same API as SQS.
 */
export function createSqsClient(config: Pick<Env, "AWS_REGION" | "SQS_ENDPOINT">): SQSClient {
  return new SQSClient({
    region: config.AWS_REGION,
    ...(config.SQS_ENDPOINT ? { endpoint: config.SQS_ENDPOINT } : {}),
  });
}

/** The application's single SQS client. */
export const sqsClient = createSqsClient(env);

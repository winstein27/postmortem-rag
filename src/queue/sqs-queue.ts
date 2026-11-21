import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from "@aws-sdk/client-sqs";
import type { z } from "zod";

export interface ReceiveOptions {
  maxMessages?: number;
  waitTimeSeconds?: number;
  visibilityTimeoutSeconds?: number;
  /**
   * Cancels the request, including a long poll in progress; receive then
   * rejects with an AbortError. A message SQS already delivered but the
   * caller never saw becomes visible again after the visibility timeout.
   */
  signal?: AbortSignal;
}

export class SqsQueue<T> {
  constructor(
    private readonly client: SQSClient,
    readonly queueUrl: string,
    private readonly schema: z.ZodType<T>,
  ) {}

  async send(body: T): Promise<string | undefined> {
    const { MessageId } = await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(body),
      }),
    );
    return MessageId;
  }

  async receive(opts: ReceiveOptions = {}): Promise<Message[]> {
    const { Messages } = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.queueUrl,
        MaxNumberOfMessages: opts.maxMessages ?? 10,
        WaitTimeSeconds: opts.waitTimeSeconds ?? 20,
        ...(opts.visibilityTimeoutSeconds !== undefined
          ? { VisibilityTimeout: opts.visibilityTimeoutSeconds }
          : {}),
      }),
      opts.signal ? { abortSignal: opts.signal } : {},
    );
    return Messages ?? [];
  }

  /**
   * Deletes a received message. Throws when the message has no receipt handle
   * or the delete fails, so the caller never treats an unacked message as done.
   */
  async ack(message: Message): Promise<void> {
    if (!message.ReceiptHandle) {
      throw new Error(
        `Cannot ack message ${message.MessageId ?? "(no id)"}: it has no receipt handle.`,
      );
    }
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  parse(message: Message): T {
    return this.schema.parse(JSON.parse(message.Body ?? "null"));
  }
}

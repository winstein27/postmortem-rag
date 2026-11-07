import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
  type SQSClient,
} from "@aws-sdk/client-sqs";

export interface ReceiveOptions {
  maxMessages?: number;
  waitTimeSeconds?: number;
  visibilityTimeoutSeconds?: number;
}

export class SqsQueue<T> {
  constructor(
    private readonly client: SQSClient,
    readonly queueUrl: string,
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
    );
    return Messages ?? [];
  }

  async ack(message: Message): Promise<void> {
    if (!message.ReceiptHandle) return;
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  parse(message: Message): T {
    return JSON.parse(message.Body ?? "null") as T;
  }
}

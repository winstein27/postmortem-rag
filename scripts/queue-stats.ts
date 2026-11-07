// Shows the queues and their message counts (works on local ElasticMQ and AWS SQS)
import { GetQueueAttributesCommand, ListQueuesCommand } from "@aws-sdk/client-sqs";
import { sqsClient } from "../src/queue/sqs-client.js";

const { QueueUrls = [] } = await sqsClient.send(new ListQueuesCommand({}));

const rows = await Promise.all(
  QueueUrls.map(async (url) => {
    const { Attributes = {} } = await sqsClient.send(
      new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: [
          "ApproximateNumberOfMessages",
          "ApproximateNumberOfMessagesNotVisible",
          "ApproximateNumberOfMessagesDelayed",
        ],
      }),
    );
    return {
      queue: url.split("/").pop(),
      available: Number(Attributes.ApproximateNumberOfMessages ?? 0),
      in_flight: Number(Attributes.ApproximateNumberOfMessagesNotVisible ?? 0),
      delayed: Number(Attributes.ApproximateNumberOfMessagesDelayed ?? 0),
    };
  }),
);

console.table(rows);
sqsClient.destroy();

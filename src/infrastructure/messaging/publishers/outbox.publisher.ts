import { OutboxRepository, OutboxMessageEntity } from '@application/ports/wager.port';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

export class OutboxPublisher {
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private readonly batchSize: number = 10;

  constructor(
    private readonly outboxRepo: OutboxRepository,
    sqsEndpoint: string,
    queueUrl: string
  ) {
    this.sqsClient = new SQSClient({
      endpoint: sqsEndpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });
    this.queueUrl = queueUrl;
  }

  async publishPending(): Promise<number> {
    const messages = await this.outboxRepo.findPending(this.batchSize);
    if (messages.length === 0) {
      return 0;
    }

    const entries = messages.map((msg: OutboxMessageEntity) => ({
      Id: msg.id,
      MessageBody: JSON.stringify({
        eventId: msg.id,
        eventType: msg.eventType,
        aggregateId: msg.aggregateId,
        correlationId: msg.aggregateId,
        causationId: msg.aggregateId,
        occurredAt: msg.occurredAt.toISOString(),
        version: 1,
        data: msg.payload,
      }),
      MessageAttributes: {
        eventType: {
          DataType: 'String',
          StringValue: msg.eventType,
        },
      },
    }));

    try {
      const command = new SendMessageBatchCommand({
        QueueUrl: this.queueUrl,
        Entries: entries,
      });

      const response = await this.sqsClient.send(command);

      if (response.Successful) {
        for (const successful of response.Successful) {
          await this.outboxRepo.markPublished(successful.Id!);
        }
      }

      if (response.Failed) {
        for (const failed of response.Failed) {
          await this.outboxRepo.markFailed(failed.Id!);
        }
      }

      return response.Successful?.length || 0;
    } catch (error) {
      for (const msg of messages) {
        await this.outboxRepo.markFailed(msg.id);
      }
      throw error;
    }
  }
}
import { EntityManager, MikroORM, LockMode } from '@mikro-orm/core';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { OutboxMessageEntity } from '@infrastructure/database/entities/outbox-message.entity';
import { mikroOrmConfig } from '@infrastructure/database/mikro-orm.config';

export class OutboxWorker {
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private readonly orm: MikroORM;
  private readonly batchSize: number = 10;
  private readonly workerId: string;
  private running: boolean = false;
  private pollInterval: number = 500;

  constructor() {
    this.sqsClient = new SQSClient({
      endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });
    this.queueUrl = process.env.SQS_OUTBOX_QUEUE_URL || 'http://localhost:4566/000000000000/wager-events.fifo';
    this.orm = MikroORM.initSync(mikroOrmConfig);
    this.workerId = `outbox-worker-${Math.random().toString(36).substring(7)}`;
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[${this.workerId}] Starting Outbox Worker...`);

    while (this.running) {
      try {
        await this.publishPending();
      } catch (error) {
        console.error(`[${this.workerId}] Error publishing events:`, error);
        await this.sleep(this.pollInterval);
      }
    }
  }

  async stop(): Promise<void> {
    console.log(`[${this.workerId}] Stopping Outbox Worker...`);
    this.running = false;
    await this.orm.close();
  }

  private async publishPending(): Promise<void> {
    const em = this.orm.em.fork();

    try {
      const messages = await this.reserveMessages(em);
      
      if (messages.length === 0) {
        await this.sleep(this.pollInterval);
        return;
      }

      console.log(`[${this.workerId}] Reserved ${messages.length} messages for publishing`);

      const entries = messages.map((msg) => ({
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

        if (response.Successful && response.Successful.length > 0) {
          await this.markPublished(em, response.Successful.map(s => s.Id!));
        }

        if (response.Failed && response.Failed.length > 0) {
          await this.markFailed(em, response.Failed.map(f => f.Id!));
        }

        console.log(`[${this.workerId}] Published ${response.Successful?.length || 0} events`);
      } catch (error) {
        console.error(`[${this.workerId}] Failed to publish batch:`, error);
        await this.markFailed(em, messages.map(m => m.id));
      }
    } finally {
      await em.close();
    }
  }

  private async reserveMessages(em: EntityManager): Promise<OutboxMessageEntity[]> {
    const now = new Date();

    // Use SELECT ... FOR UPDATE SKIP LOCKED to allow parallel workers
    const messages = await em.createQueryBuilder(OutboxMessageEntity, 'o')
      .select('*')
      .where({
        $or: [
          { publishedAt: null, nextAttemptAt: { $lte: now } },
        ],
      })
      .orderBy({ occurredAt: 'ASC' })
      .setLockMode(LockMode.PESSIMISTIC_WRITE)
      .setHint('SKIP_LOCKED', true)
      .limit(this.batchSize)
      .getResult();

    return messages;
  }

  private async markPublished(em: EntityManager, ids: string[]): Promise<void> {
    const repo = em.getRepository(OutboxMessageEntity);
    await repo.nativeUpdate(
      { id: { $in: ids } },
      { publishedAt: new Date(), attempts: 0 }
    );
  }

  private async markFailed(em: EntityManager, ids: string[]): Promise<void> {
    const repo = em.getRepository(OutboxMessageEntity);
    for (const id of ids) {
      const entity = await repo.findOne({ id });
      if (entity) {
        entity.attempts += 1;
        const delay = Math.min(2 ** entity.attempts * 1000, 300000);
        entity.nextAttemptAt = new Date(Date.now() + delay);
      }
    }
    await em.flush();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function main() {
  const worker = new OutboxWorker();
  
  process.on('SIGTERM', async () => {
    await worker.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await worker.stop();
    process.exit(0);
  });

  await worker.start();
}

if (import.meta.main) {
  main().catch(console.error);
}
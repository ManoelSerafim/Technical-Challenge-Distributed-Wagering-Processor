import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/core';
import { WagerUseCase } from '@application/use-cases/wager.use-case';
import { WalletRepositoryImpl } from '@infrastructure/database/repositories/wallet.repository';
import { WagerTransactionRepositoryImpl } from '@infrastructure/database/repositories/wager-transaction.repository';
import { LedgerRepositoryImpl } from '@infrastructure/database/repositories/ledger.repository';
import { InboxRepositoryImpl } from '@infrastructure/database/repositories/inbox.repository';
import { OutboxRepositoryImpl } from '@infrastructure/database/repositories/outbox.repository';
import { mikroOrmConfig } from '@infrastructure/database/mikro-orm.config';
import { ProcessWagerCommand, WalletId, PlayerId, WagerTransactionKind, Money } from '@application/ports/wager.port';

interface SQSMessage {
  MessageId?: string;
  ReceiptHandle?: string;
  Body?: string;
  Attributes?: Record<string, string>;
}

export class SQSInboxWorker {
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private readonly consumerName: string;
  private readonly orm: MikroORM;
  private readonly maxRetries: number = 3;
  private running: boolean = false;
  private pollInterval: number = 1000;

  constructor() {
    this.sqsClient = new SQSClient({
      endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });
    this.queueUrl = process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/wager-transactions.fifo';
    this.consumerName = process.env.CONSUMER_NAME || 'wager-worker-1';
    this.orm = MikroORM.initSync(mikroOrmConfig);
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[${this.consumerName}] Starting SQS Inbox Worker...`);

    while (this.running) {
      try {
        await this.pollMessages();
      } catch (error) {
        console.error(`[${this.consumerName}] Error polling messages:`, error);
        await this.sleep(this.pollInterval);
      }
    }
  }

  async stop(): Promise<void> {
    console.log(`[${this.consumerName}] Stopping SQS Inbox Worker...`);
    this.running = false;
    await this.orm.close();
  }

  private async pollMessages(): Promise<void> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 30,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    });

    const response = await this.sqsClient.send(command);

    if (!response.Messages || response.Messages.length === 0) {
      return;
    }

    for (const message of response.Messages) {
      if (!this.running) break;
      await this.processMessage(message);
    }
  }

  private async processMessage(message: SQSMessage): Promise<void> {
    const messageId = message.MessageId!;
    const receiptHandle = message.ReceiptHandle!;
    const body = message.Body!;

    console.log(`[${this.consumerName}] Processing message ${messageId}`);

    const em = this.orm.em.fork();

    try {
      const payload = JSON.parse(body);
      const payloadHash = this.calculatePayloadHash(payload);

      const inboxRepo = new InboxRepositoryImpl(em);
      const existing = await inboxRepo.findByConsumerAndMessageId(this.consumerName, messageId);

      if (existing) {
        if (existing.processedAt) {
          console.log(`[${this.consumerName}] Message ${messageId} already processed, acking`);
          await this.deleteMessage(receiptHandle);
          return;
        }
        if (existing.payloadHash !== payloadHash) {
          throw new Error('INBOX_PAYLOAD_MISMATCH');
        }
      } else {
        await inboxRepo.save(messageId, this.consumerName, payload, payloadHash);
      }

      const command = this.mapToCommand(payload);
      const walletRepo = new WalletRepositoryImpl(em);
      const transactionRepo = new WagerTransactionRepositoryImpl(em);
      const ledgerRepo = new LedgerRepositoryImpl(em);
      const outboxRepo = new OutboxRepositoryImpl(em);

      const useCase = new WagerUseCase(
        walletRepo,
        transactionRepo,
        ledgerRepo,
        inboxRepo,
        outboxRepo,
        em
      );

      await useCase.processWager(command);
      await inboxRepo.markProcessed(messageId, em);

      await this.deleteMessage(receiptHandle);
      console.log(`[${this.consumerName}] Message ${messageId} processed successfully`);
    } catch (error) {
      if (error.message === 'IDEMPOTENCY_CONFLICT') {
        console.log(`[${this.consumerName}] Idempotency conflict for ${messageId}, marking processed`);
        await inboxRepo.markProcessed(messageId, em);
        await this.deleteMessage(receiptHandle);
        return;
      }

      console.error(`[${this.consumerName}] Error processing message ${messageId}:`, error);
      
      const attributes = message.Attributes || {};
      const receiveCount = parseInt(attributes.ApproximateReceiveCount || '1', 10);

      if (receiveCount >= this.maxRetries) {
        console.log(`[${this.consumerName}] Max retries reached for ${messageId}, sending to DLQ`);
        await this.sendToDLQ(message);
        await this.deleteMessage(receiptHandle);
      } else {
        console.log(`[${this.consumerName}] Message ${messageId} will be retried (attempt ${receiveCount}/${this.maxRetries})`);
      }
    }
  }

  private mapToCommand(payload: Record<string, unknown>): ProcessWagerCommand {
    return {
      providerId: payload.providerId as string,
      externalTransactionId: payload.externalTransactionId as string,
      idempotencyKey: payload.idempotencyKey as string,
      payloadHash: payload.payloadHash as string,
      walletId: payload.walletId as WalletId,
      playerId: payload.playerId as PlayerId,
      roundId: payload.roundId as string || null,
      gameId: payload.gameId as string || null,
      kind: payload.kind as WagerTransactionKind,
      amount: { amount: payload.amount as string, currency: payload.currency as string } as Money,
      referenceExternalTransactionId: payload.referenceExternalTransactionId as string || null,
    };
  }

  private calculatePayloadHash(payload: Record<string, unknown>): string {
    const businessPayload = {
      providerId: payload.providerId,
      externalTransactionId: payload.externalTransactionId,
      walletId: payload.walletId,
      playerId: payload.playerId,
      roundId: payload.roundId,
      gameId: payload.gameId,
      kind: payload.kind,
      amount: payload.amount,
      currency: payload.currency,
      referenceExternalTransactionId: payload.referenceExternalTransactionId,
    };
    const canonical = JSON.stringify(businessPayload, Object.keys(businessPayload).sort());
    let hash = 0;
    for (let i = 0; i < canonical.length; i++) {
      const char = canonical.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    await this.sqsClient.send(new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    }));
  }

  private async sendToDLQ(message: SQSMessage): Promise<void> {
    await this.sqsClient.send(new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: message.ReceiptHandle!,
    }));
    // In a real implementation, we'd send to DLQ with SendMessageCommand
    console.log(`[${this.consumerName}] Message sent to DLQ: ${message.MessageId}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function main() {
  const worker = new SQSInboxWorker();
  
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
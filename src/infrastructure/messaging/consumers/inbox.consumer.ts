import { InboxRepository, WagerTransactionRepository, WalletRepository, LedgerRepository, OutboxRepository, EntityManager, ProcessWagerCommand, WalletId, PlayerId, WagerTransactionKind, Money } from '@application/ports/wager.port';
import { WagerUseCase } from '@application/use-cases/wager.use-case';

export interface SQSMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes?: Record<string, string>;
}

export class InboxConsumer {
  constructor(
    private readonly inboxRepo: InboxRepository,
    private readonly transactionRepo: WagerTransactionRepository,
    private readonly walletRepo: WalletRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly outboxRepo: OutboxRepository,
    private readonly em: EntityManager,
    private readonly consumerName: string
  ) {}

  async processMessage(message: SQSMessage): Promise<boolean> {
    const payload = JSON.parse(message.body);
    const payloadHash = this.hashPayload(payload);

    const existing = await this.inboxRepo.findByConsumerAndMessageId(this.consumerName, message.messageId);
    if (existing) {
      if (existing.processedAt) {
        return true;
      }
      if (existing.payloadHash !== payloadHash) {
        throw new Error('INBOX_PAYLOAD_MISMATCH');
      }
    } else {
      await this.inboxRepo.save(message.messageId, this.consumerName, payload, payloadHash);
    }

    const command = this.mapToCommand(payload);
    const useCase = new WagerUseCase(
      this.walletRepo,
      this.transactionRepo,
      this.ledgerRepo,
      this.outboxRepo,
      this.em
    );

    try {
      await useCase.processWager(command);
      await this.inboxRepo.markProcessed(message.messageId, this.em);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT') {
        await this.inboxRepo.markProcessed(message.messageId, this.em);
        return true;
      }
      throw error;
    }
  }

  private hashPayload(payload: Record<string, unknown>): string {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    let hash = 0;
    for (let i = 0; i < canonical.length; i++) {
      const char = canonical.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
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
}
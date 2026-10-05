import { EntityManager, MikroORM } from '@mikro-orm/core';
import { WagerUseCase } from '@application/use-cases/wager.use-case';
import { WalletRepositoryImpl } from '@infrastructure/database/repositories/wallet.repository';
import { WagerTransactionRepositoryImpl } from '@infrastructure/database/repositories/wager-transaction.repository';
import { LedgerRepositoryImpl } from '@infrastructure/database/repositories/ledger.repository';
import { InboxRepositoryImpl } from '@infrastructure/database/repositories/inbox.repository';
import { OutboxRepositoryImpl } from '@infrastructure/database/repositories/outbox.repository';
import { WagerTransactionEntity } from '@infrastructure/database/entities/wager-transaction.entity';
import { WagerTransactionStatus } from '@domain/wager';
import { mikroOrmConfig } from '@infrastructure/database/mikro-orm.config';
import { WalletId, PlayerId, Money } from '@application/ports/wager.port';
import { WagerTransaction } from '@domain/wager';
import { Shutdownable } from '@common/shutdown/shutdown.service';

export class PendingReferenceWorker implements Shutdownable {
  private readonly orm: MikroORM;
  private readonly maxRetries: number = 10;
  private readonly baseDelayMs: number = 5000;
  private readonly maxDelayMs: number = 300000;
  private running: boolean = false;
  private processing: boolean = false;
  private pollInterval: number = 10000;
  private shutdownPromise: Promise<void> | null = null;

  constructor() {
    this.orm = MikroORM.initSync(mikroOrmConfig);
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[PendingReferenceWorker] Starting...`);

    while (this.running) {
      try {
        if (!this.processing) {
          await this.reprocessPendingReferences();
        } else {
          await this.sleep(100);
        }
      } catch (error) {
        if (this.running) {
          console.error('[PendingReferenceWorker] Error:', error);
        }
      }
      if (this.running) {
        await this.sleep(this.pollInterval);
      }
    }

    if (this.shutdownPromise) {
      await this.shutdownPromise;
    }
  }

  async shutdown(): Promise<void> {
    console.log('[PendingReferenceWorker] Initiating graceful shutdown...');
    this.running = false;

    this.shutdownPromise = new Promise((resolve) => {
      const checkProcessing = () => {
        if (this.processing) {
          setTimeout(checkProcessing, 500);
        } else {
          resolve();
        }
      };
      checkProcessing();
    });

    await this.shutdownPromise;
    await this.orm.close();
    console.log('[PendingReferenceWorker] Graceful shutdown complete');
  }

  private async reprocessPendingReferences(): Promise<void> {
    if (!this.running) return;

    this.processing = true;
    const em = this.orm.em.fork();

    try {
      const repo = em.getRepository(WagerTransactionEntity);
      
      const pendingRefs = await repo.find({
        status: WagerTransactionStatus.PENDING_REFERENCE,
      }, {
        orderBy: { createdAt: 'ASC' },
        limit: 50,
      });

      if (pendingRefs.length === 0) {
        return;
      }

      console.log(`[PendingReferenceWorker] Found ${pendingRefs.length} pending reference transactions`);

      for (const entity of pendingRefs) {
        if (!this.running) break;
        await this.processPendingReference(entity, em);
      }
    } finally {
      await em.close();
      this.processing = false;
    }
  }

  private async processPendingReference(entity: WagerTransactionEntity, em: EntityManager): Promise<void> {
    const transaction = entity.toDomain();
    
    if (!transaction.referenceExternalTransactionId) {
      console.warn(`[PendingReferenceWorker] Transaction ${transaction.id} has no reference, rejecting`);
      transaction.markRejected('REFERENCE_NOT_FOUND');
      await this.updateTransaction(transaction, em);
      return;
    }

    const referenceRepo = em.getRepository(WagerTransactionEntity);
    const referenceEntity = await referenceRepo.findOne({
      walletId: transaction.walletId,
      externalTransactionId: transaction.referenceExternalTransactionId,
    });

    if (!referenceEntity) {
      console.log(`[PendingReferenceWorker] Reference ${transaction.referenceExternalTransactionId} not found for ${transaction.id}, will retry`);
      await this.incrementRetryAndSchedule(entity, em);
      return;
    }

    const referenceTxn = referenceEntity.toDomain();

    if (!referenceTxn.isTerminal()) {
      console.log(`[PendingReferenceWorker] Reference ${referenceTxn.id} not terminal yet for ${transaction.id}, will retry`);
      await this.incrementRetryAndSchedule(entity, em);
      return;
    }

    try {
      transaction.setReferenceTransactionId(referenceTxn.id);
      
      const walletRepo = new WalletRepositoryImpl(em);
      const transactionRepo = new WagerTransactionRepositoryImpl(em);
      const ledgerRepo = new LedgerRepositoryImpl(em);
      const inboxRepo = new InboxRepositoryImpl(em);
      const outboxRepo = new OutboxRepositoryImpl(em);

      const useCase = new WagerUseCase(
        walletRepo,
        transactionRepo,
        ledgerRepo,
        inboxRepo,
        outboxRepo,
        em
      );

      await useCase.processWager({
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        idempotencyKey: transaction.idempotencyKey,
        payloadHash: transaction.payloadHash,
        walletId: transaction.walletId as WalletId,
        playerId: transaction.playerId as PlayerId,
        roundId: transaction.roundId,
        gameId: transaction.gameId,
        kind: transaction.kind,
        amount: { amount: transaction.amount, currency: transaction.currency } as Money,
        referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      });

      console.log(`[PendingReferenceWorker] Successfully processed ${transaction.id} with reference ${referenceTxn.id}`);
    } catch (error) {
      if (error instanceof Error && (
        error.message === 'REFERENCE_NOT_FOUND' || error.message === 'REFERENCE_NOT_TERMINAL' ||
        error.message === 'INVALID_REFERENCE_KIND' || error.message === 'AMOUNT_MISMATCH' ||
        error.message === 'DUPLICATE_REFUND' || error.message === 'DUPLICATE_ROLLBACK' ||
        error.message === 'ROLLBACK_WOULD_NEGATIVE_BALANCE')) {
        console.log(`[PendingReferenceWorker] Business rejection for ${transaction.id}: ${error.message}`);
        transaction.markRejected(error.message);
        await this.updateTransaction(transaction, em);
      } else {
        console.error(`[PendingReferenceWorker] Error processing ${transaction.id}:`, error);
        await this.incrementRetryAndSchedule(entity, em);
      }
    }
  }

  private async incrementRetryAndSchedule(entity: WagerTransactionEntity, em: EntityManager): Promise<void> {
    const retryCount = (entity as Record<string, unknown>).retryCount as number || 0;
    const nextRetryCount = retryCount + 1;

    if (nextRetryCount >= this.maxRetries) {
      console.log(`[PendingReferenceWorker] Max retries reached for ${entity.id}, rejecting`);
      const transaction = entity.toDomain();
      transaction.markRejected('MAX_RETRIES_EXCEEDED');
      await this.updateTransaction(transaction, em);
      return;
    }

    await em.getRepository(WagerTransactionEntity).nativeUpdate(
      { id: entity.id },
      { 
        updatedAt: new Date(),
      }
    );
  }

  private async updateTransaction(transaction: WagerTransaction, em: EntityManager): Promise<void> {
    const repo = em.getRepository(WagerTransactionEntity);
    const entity = await repo.findOne({ id: transaction.id });
    if (entity) {
      entity.updateFromDomain(transaction);
      await em.flush();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

async function main() {
  const worker = new PendingReferenceWorker();
  
  process.on('SIGTERM', async () => {
    await worker.shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await worker.shutdown();
    process.exit(0);
  });

  await worker.start();
}

if (import.meta.main) {
  main().catch(console.error);
}
import {
  WalletRepository,
  WagerTransactionRepository,
  LedgerRepository,
  OutboxRepository,
  EntityManager,
  Wallet,
  WagerTransaction,
  ProcessWagerCommand,
  ProcessWagerResult,
  ReconciliationResult,
  WalletId,
  Money,
} from '../ports/wager.port';
import { WagerTransactionKind, WagerTransactionStatus } from '@domain/wager';
import { LedgerDirection, WalletLedgerEntry } from '@domain/ledger';
import { StructuredLogger, LogContext } from '@common/logger/structured-logger';
import { MetricsCollector, METRIC_NAMES } from '@common/metrics/metrics';

export class WagerUseCase {
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(
    private readonly walletRepo: WalletRepository,
    private readonly transactionRepo: WagerTransactionRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly outboxRepo: OutboxRepository,
    private readonly em: EntityManager,
    logger?: StructuredLogger,
    metrics?: MetricsCollector
  ) {
    this.logger = logger || new StructuredLogger('WagerUseCase');
    this.metrics = metrics || new MetricsCollector();
  }

  async processWager(command: ProcessWagerCommand): Promise<ProcessWagerResult> {
    const startTime = Date.now();
    const baseContext: LogContext = {
      correlationId: command.idempotencyKey,
      walletId: command.walletId,
      providerId: command.providerId,
      playerId: command.playerId,
      operation: 'processWager',
      kind: command.kind,
    };

    this.logger.log('Processing wager transaction', baseContext);

    return this.em.transactional(async () => {
      const existingByIdempotency = await this.transactionRepo.findByIdempotencyKey(command.idempotencyKey);
      if (existingByIdempotency) {
        if (existingByIdempotency.payloadHash !== command.payloadHash) {
          this.metrics.incrementCounter(METRIC_NAMES.IDEMPOTENCY_CONFLICTS, { providerId: command.providerId });
          this.logger.warn('Idempotency conflict detected', { ...baseContext, status: 'conflict' });
          throw new Error('IDEMPOTENCY_CONFLICT');
        }
        this.logger.log('Idempotent replay', { ...baseContext, status: 'replay', transactionId: existingByIdempotency.id });
        return {
          transactionId: existingByIdempotency.id,
          status: existingByIdempotency.status,
          failureCode: existingByIdempotency.failureCode || undefined,
          idempotentReplay: true,
        };
      }

      const wallet = await this.walletRepo.findByIdLocked(command.walletId, this.em);
      if (!wallet) {
        this.logger.warn('Wallet not found', { ...baseContext, status: 'wallet_not_found' });
        throw new Error('WALLET_NOT_FOUND');
      }

      if (wallet.currency !== command.amount.currency) {
        this.logger.warn('Currency mismatch', { ...baseContext, status: 'currency_mismatch', walletCurrency: wallet.currency, txCurrency: command.amount.currency });
        throw new Error('CURRENCY_MISMATCH');
      }

      const transaction = this.createTransaction(command);
      await this.transactionRepo.saveInTransaction(transaction, this.em);

      const referenceTxn = await this.resolveReference(transaction, wallet);
      if (!referenceTxn && this.requiresReference(transaction.kind)) {
        transaction.setReferenceTransactionId('');
        transaction.markRejected('REFERENCE_NOT_FOUND');
        await this.transactionRepo.saveInTransaction(transaction, this.em);
        await this.publishEvents(transaction, wallet);
        this.logger.warn('Reference not found', { ...baseContext, status: 'rejected', failureCode: 'REFERENCE_NOT_FOUND' });
        return {
          transactionId: transaction.id,
          status: WagerTransactionStatus.REJECTED,
          failureCode: 'REFERENCE_NOT_FOUND',
        };
      }

      await this.applyFinancialRules(transaction, wallet, referenceTxn);

      if (transaction.status === WagerTransactionStatus.PROCESSED) {
        await this.createLedgerEntry(transaction, wallet);
      }

      await this.walletRepo.saveInTransaction(wallet, this.em);
      await this.transactionRepo.saveInTransaction(transaction, this.em);
      await this.publishEvents(transaction, wallet);

      const durationMs = Date.now() - startTime;
      this.metrics.recordHistogram(METRIC_NAMES.TRANSACTIONS_DURATION_MS, durationMs, { kind: command.kind });
      this.metrics.incrementCounter(METRIC_NAMES.TRANSACTIONS_BY_STATUS, { kind: command.kind, status: transaction.status });

      if (transaction.status === WagerTransactionStatus.REJECTED) {
        this.logger.warn('Transaction rejected', { ...baseContext, status: 'rejected', failureCode: transaction.failureCode, durationMs });
      } else {
        this.logger.log('Transaction processed', { ...baseContext, status: 'processed', transactionId: transaction.id, balanceAfter: wallet.balance.amount, durationMs });
      }

      return {
        transactionId: transaction.id,
        status: transaction.status,
        failureCode: transaction.failureCode || undefined,
        balanceAfter: wallet.balance,
      };
    });
  }

  private createTransaction(command: ProcessWagerCommand): WagerTransaction {
    return WagerTransaction.create({
      providerId: command.providerId,
      externalTransactionId: command.externalTransactionId,
      idempotencyKey: command.idempotencyKey,
      payloadHash: command.payloadHash,
      walletId: command.walletId,
      playerId: command.playerId,
      roundId: command.roundId,
      gameId: command.gameId,
      kind: command.kind,
      amount: command.amount.amount,
      currency: command.amount.currency,
      referenceExternalTransactionId: command.referenceExternalTransactionId,
    });
  }

  private requiresReference(kind: WagerTransactionKind): boolean {
    return kind === WagerTransactionKind.REFUND || kind === WagerTransactionKind.ROLLBACK;
  }

  private async resolveReference(
    transaction: WagerTransaction,
    wallet: Wallet
  ): Promise<WagerTransaction | null> {
    if (!transaction.referenceExternalTransactionId) {
      return null;
    }

    const referenceTxn = await this.transactionRepo.findByExternalReference(
      wallet.id,
      transaction.referenceExternalTransactionId
    );

    if (!referenceTxn) {
      return null;
    }

    if (!referenceTxn.isTerminal()) {
      throw new Error('REFERENCE_NOT_TERMINAL');
    }

    transaction.setReferenceTransactionId(referenceTxn.id);
    return referenceTxn;
  }

  private async applyFinancialRules(
    transaction: WagerTransaction,
    wallet: Wallet,
    referenceTxn: WagerTransaction | null
  ): Promise<void> {
    const amount = Money.from({ amount: transaction.amount, currency: transaction.currency });

    switch (transaction.kind) {
      case WagerTransactionKind.OPENING:
        if (!wallet.balance.isZero()) {
          transaction.markRejected('WALLET_ALREADY_INITIALIZED');
          return;
        }
        wallet.credit(amount);
        transaction.markProcessed();
        break;

      case WagerTransactionKind.BET:
        if (wallet.balance.isLessThan(amount)) {
          transaction.markRejected('INSUFFICIENT_BALANCE');
          return;
        }
        wallet.debit(amount);
        transaction.markProcessed();
        break;

      case WagerTransactionKind.WIN:
        wallet.credit(amount);
        transaction.markProcessed();
        break;

      case WagerTransactionKind.LOSS:
        transaction.markProcessed();
        break;

      case WagerTransactionKind.REFUND:
        if (!referenceTxn) {
          transaction.markRejected('REFERENCE_NOT_FOUND');
          return;
        }
        if (referenceTxn.kind !== WagerTransactionKind.BET) {
          transaction.markRejected('INVALID_REFERENCE_KIND');
          return;
        }
        if (referenceTxn.amount !== transaction.amount) {
          transaction.markRejected('AMOUNT_MISMATCH');
          return;
        }
        if (await this.hasRefundBeenProcessed(referenceTxn.id)) {
          transaction.markRejected('DUPLICATE_REFUND');
          return;
        }
        wallet.credit(amount);
        transaction.markProcessed();
        break;

      case WagerTransactionKind.ROLLBACK:
        if (!referenceTxn) {
          transaction.markRejected('REFERENCE_NOT_FOUND');
          return;
        }
        if (!this.canRollback(referenceTxn.kind)) {
          transaction.markRejected('INVALID_REFERENCE_KIND');
          return;
        }
        if (referenceTxn.amount !== transaction.amount) {
          transaction.markRejected('AMOUNT_MISMATCH');
          return;
        }
        if (await this.hasRollbackBeenProcessed(referenceTxn.id)) {
          transaction.markRejected('DUPLICATE_ROLLBACK');
          return;
        }
        await this.applyRollback(referenceTxn, wallet, amount);
        transaction.markProcessed();
        break;

      default:
        transaction.markFailed('UNKNOWN_TRANSACTION_KIND');
    }
  }

  private async hasRefundBeenProcessed(referenceTransactionId: string): Promise<boolean> {
    const existingRefund = await this.transactionRepo.findPendingReferenceByExternalRef('', referenceTransactionId);
    return !!existingRefund;
  }

  private async hasRollbackBeenProcessed(referenceTransactionId: string): Promise<boolean> {
    const existingRollback = await this.transactionRepo.findByExternalReference('', referenceTransactionId);
    if (!existingRollback) return false;
    return existingRollback.kind === WagerTransactionKind.ROLLBACK && existingRollback.status === WagerTransactionStatus.PROCESSED;
  }

  private canRollback(referenceKind: WagerTransactionKind): boolean {
    return [
      WagerTransactionKind.BET,
      WagerTransactionKind.WIN,
      WagerTransactionKind.REFUND,
    ].includes(referenceKind);
  }

  private async applyRollback(
    referenceTxn: WagerTransaction,
    wallet: Wallet,
    amount: Money
  ): Promise<void> {
    switch (referenceTxn.kind) {
      case WagerTransactionKind.BET:
        wallet.credit(amount);
        break;
      case WagerTransactionKind.WIN:
        if (wallet.balance.isLessThan(amount)) {
          throw new Error('ROLLBACK_WOULD_NEGATIVE_BALANCE');
        }
        wallet.debit(amount);
        break;
      case WagerTransactionKind.REFUND:
        if (wallet.balance.isLessThan(amount)) {
          throw new Error('ROLLBACK_WOULD_NEGATIVE_BALANCE');
        }
        wallet.debit(amount);
        break;
    }
  }

  private async createLedgerEntry(
    transaction: WagerTransaction,
    wallet: Wallet
  ): Promise<void> {
    if (transaction.kind === WagerTransactionKind.LOSS) {
      return;
    }

    const amount = Money.from({ amount: transaction.amount, currency: transaction.currency });
    let direction: LedgerDirection;
    let balanceBefore: Money;

    switch (transaction.kind) {
      case WagerTransactionKind.OPENING:
      case WagerTransactionKind.WIN:
      case WagerTransactionKind.REFUND:
        direction = LedgerDirection.CREDIT;
        balanceBefore = wallet.balance.subtract(amount);
        break;
      case WagerTransactionKind.BET:
        direction = LedgerDirection.DEBIT;
        balanceBefore = wallet.balance.add(amount);
        break;
      case WagerTransactionKind.ROLLBACK: {
        const referenceTxn = await this.transactionRepo.findById(transaction.referenceTransactionId!);
        if (referenceTxn?.kind === WagerTransactionKind.BET) {
          direction = LedgerDirection.CREDIT;
          balanceBefore = wallet.balance.subtract(amount);
        } else {
          direction = LedgerDirection.DEBIT;
          balanceBefore = wallet.balance.add(amount);
        }
        break;
      }
      default:
        return;
    }

    const entry = WalletLedgerEntry.create({
      walletId: wallet.id,
      transactionId: transaction.id,
      direction,
      amount,
      balanceBefore,
      balanceAfter: wallet.balance,
    });

    await this.ledgerRepo.saveInTransaction(entry, this.em);
  }

  private async publishEvents(
    transaction: WagerTransaction,
    wallet: Wallet
  ): Promise<void> {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];

    if (transaction.status === WagerTransactionStatus.PROCESSED) {
      events.push({
        type: 'WagerTransactionProcessed',
        payload: {
          transactionId: transaction.id,
          walletId: wallet.id,
          playerId: wallet.playerId,
          kind: transaction.kind,
          amount: transaction.amount,
          currency: transaction.currency,
          balanceAfter: wallet.balance.amount,
        },
      });

      if (wallet.balance.amount !== '0.00') {
        events.push({
          type: 'WalletBalanceChanged',
          payload: {
            walletId: wallet.id,
            playerId: wallet.playerId,
            balance: wallet.balance.amount,
            currency: wallet.balance.currency,
          },
        });
      }
    } else if (transaction.status === WagerTransactionStatus.REJECTED) {
      events.push({
        type: 'WagerTransactionRejected',
        payload: {
          transactionId: transaction.id,
          walletId: wallet.id,
          playerId: wallet.playerId,
          kind: transaction.kind,
          failureCode: transaction.failureCode,
        },
      });
    } else if (transaction.status === WagerTransactionStatus.PENDING_REFERENCE) {
      events.push({
        type: 'WagerTransactionPendingReference',
        payload: {
          transactionId: transaction.id,
          walletId: wallet.id,
          playerId: wallet.playerId,
          kind: transaction.kind,
          referenceExternalTransactionId: transaction.referenceExternalTransactionId,
        },
      });
    }

    for (const event of events) {
      await this.outboxRepo.saveInTransaction(transaction.id, event.type, event.payload, this.em);
    }
  }

  async reconcile(walletId: WalletId): Promise<ReconciliationResult> {
    const startTime = Date.now();
    const context: LogContext = { walletId, operation: 'reconcile' };
    
    this.logger.log('Starting reconciliation', context);

    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) {
      throw new Error('WALLET_NOT_FOUND');
    }

    const entries = await this.ledgerRepo.findByWalletId(walletId);
    let calculatedBalance = Money.zero(wallet.currency);

    for (const entry of entries) {
      if (entry.direction === LedgerDirection.CREDIT) {
        calculatedBalance = calculatedBalance.add(entry.amount);
      } else {
        calculatedBalance = calculatedBalance.subtract(entry.amount);
      }
    }

    const difference = wallet.balance.subtract(calculatedBalance);
    const consistent = difference.isZero();

    const durationMs = Date.now() - startTime;
    this.metrics.recordHistogram(METRIC_NAMES.RECONCILIATION_DURATION_MS, durationMs);
    
    if (!consistent) {
      this.metrics.incrementCounter(METRIC_NAMES.RECONCILIATION_DIVERGENCES, { walletId });
      this.logger.warn('Reconciliation divergence detected', { 
        ...context, 
        storedBalance: wallet.balance.amount,
        calculatedBalance: calculatedBalance.amount,
        difference: difference.amount,
      });
    } else {
      this.logger.log('Reconciliation successful', { 
        ...context, 
        balance: wallet.balance.amount,
        durationMs,
      });
    }

    return {
      walletId,
      storedBalance: wallet.balance,
      calculatedBalance,
      difference,
      consistent,
      checkedEntries: entries.length,
    };
  }
}

export function createWagerUseCase(
  walletRepo: WalletRepository,
  transactionRepo: WagerTransactionRepository,
  ledgerRepo: LedgerRepository,
  outboxRepo: OutboxRepository,
  em: EntityManager,
  logger?: StructuredLogger,
  metrics?: MetricsCollector
): WagerUseCase {
  return new WagerUseCase(walletRepo, transactionRepo, ledgerRepo, outboxRepo, em, logger, metrics);
}
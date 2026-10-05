import { EntityManager, EntityRepository, FilterQuery, LockMode } from '@mikro-orm/core';
import { Wallet, WalletId, PlayerId, asWalletId, asPlayerId } from '@domain/wallet';
import { Money } from '@domain/money';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from '@domain/wager';
import { WalletLedgerEntry, LedgerDirection } from '@domain/ledger';

export type { WalletId, PlayerId };
export { asWalletId, asPlayerId };

export interface CreateWalletCommand {
  playerId: PlayerId;
  currency: string;
  initialBalance?: Money;
}

export interface ProcessWagerCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: WalletId;
  playerId: PlayerId;
  roundId: string | null;
  gameId: string | null;
  kind: WagerTransactionKind;
  amount: Money;
  referenceExternalTransactionId: string | null;
}

export interface ProcessWagerResult {
  transactionId: string;
  status: WagerTransactionStatus;
  failureCode: string | undefined;
  balanceAfter?: Money;
  idempotentReplay?: boolean;
}

export interface ReconciliationResult {
  walletId: WalletId;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

export interface WalletRepository {
  findById(id: WalletId): Promise<Wallet | null>;
  findByIdLocked(id: WalletId, em: EntityManager): Promise<Wallet | null>;
  findByPlayerIdAndCurrency(playerId: PlayerId, currency: string): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
  saveInTransaction(wallet: Wallet, em: EntityManager): Promise<void>;
}

export interface WagerTransactionRepository {
  findByIdempotencyKey(key: string): Promise<WagerTransaction | null>;
  findById(id: string): Promise<WagerTransaction | null>;
  findByExternalReference(walletId: string, externalTransactionId: string): Promise<WagerTransaction | null>;
  findPendingReferenceByExternalRef(walletId: string, referenceExternalTransactionId: string): Promise<WagerTransaction | null>;
  save(transaction: WagerTransaction): Promise<void>;
  saveInTransaction(transaction: WagerTransaction, em: EntityManager): Promise<void>;
}

export interface LedgerRepository {
  findByWalletId(walletId: string): Promise<WalletLedgerEntry[]>;
  save(entry: WalletLedgerEntry): Promise<void>;
  saveInTransaction(entry: WalletLedgerEntry, em: EntityManager): Promise<void>;
}

export interface InboxRepository {
  findByConsumerAndMessageId(consumerName: string, messageId: string): Promise<InboxMessageEntity | null>;
  save(messageId: string, consumerName: string, payload: Record<string, unknown>, payloadHash: string): Promise<void>;
  markProcessed(id: string, em: EntityManager): Promise<void>;
}

export interface OutboxRepository {
  save(aggregateId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
  saveInTransaction(aggregateId: string, eventType: string, payload: Record<string, unknown>, em: EntityManager): Promise<void>;
  findPending(limit: number): Promise<OutboxMessageEntity[]>;
  markPublished(id: string): Promise<void>;
  markFailed(id: string): Promise<void>;
}

export interface InboxMessageEntity {
  id: string;
  messageId: string;
  consumerName: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface OutboxMessageEntity {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date | null;
  publishedAt: Date | null;
}

export type { EntityManager, EntityRepository, FilterQuery, LockMode };
export { Wallet, Money, WagerTransaction, WagerTransactionKind, WagerTransactionStatus, WalletLedgerEntry, LedgerDirection };
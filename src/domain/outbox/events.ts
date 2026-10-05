export interface DomainEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  correlationId: string;
  causationId: string;
  occurredAt: string;
  version: number;
  data: Record<string, unknown>;
}

export interface WagerTransactionProcessedEvent {
  transactionId: string;
  walletId: string;
  playerId: string;
  kind: string;
  amount: string;
  currency: string;
  balanceAfter: string;
}

export interface WalletBalanceChangedEvent {
  walletId: string;
  playerId: string;
  balance: string;
  currency: string;
}

export interface WagerTransactionRejectedEvent {
  transactionId: string;
  walletId: string;
  playerId: string;
  kind: string;
  failureCode: string | null;
}

export interface WagerTransactionPendingReferenceEvent {
  transactionId: string;
  walletId: string;
  playerId: string;
  kind: string;
  referenceExternalTransactionId: string;
}

export function createEvent<T extends Record<string, unknown>>(
  eventType: string,
  aggregateId: string,
  data: T,
  correlationId?: string,
  causationId?: string
): DomainEvent {
  return {
    eventId: uuidv4(),
    eventType,
    aggregateId,
    correlationId: correlationId || aggregateId,
    causationId: causationId || aggregateId,
    occurredAt: new Date().toISOString(),
    version: 1,
    data,
  };
}

import { v4 as uuidv4 } from 'uuid';
import { test, expect, describe } from 'bun:test';
import { WagerTransaction, WagerTransactionKind, WagerTransactionStatus } from './wager-transaction';

describe('WagerTransaction', () => {
  const baseProps = {
    providerId: 'provider-1',
    externalTransactionId: 'txn-123',
    idempotencyKey: 'provider-1:txn-123',
    payloadHash: 'hash-abc',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
  };

  describe('Creation', () => {
    test('creates BET transaction in PENDING status', () => {
      const txn = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.BET,
        amount: '50.00',
        currency: 'BRL',
        referenceExternalTransactionId: null,
      });
      expect(txn.kind).toBe(WagerTransactionKind.BET);
      expect(txn.status).toBe(WagerTransactionStatus.PENDING);
      expect(txn.amount).toBe('50.00');
      expect(txn.currency).toBe('BRL');
    });

    test('creates WIN transaction in PENDING status', () => {
      const txn = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.WIN,
        amount: '100.00',
        currency: 'BRL',
        referenceExternalTransactionId: null,
      });
      expect(txn.status).toBe(WagerTransactionStatus.PENDING);
    });

    test('creates REFUND transaction in PENDING_REFERENCE status', () => {
      const txn = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.REFUND,
        amount: '50.00',
        currency: 'BRL',
        referenceExternalTransactionId: 'bet-123',
      });
      expect(txn.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);
      expect(txn.referenceExternalTransactionId).toBe('bet-123');
    });

    test('creates ROLLBACK transaction in PENDING_REFERENCE status', () => {
      const txn = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.ROLLBACK,
        amount: '50.00',
        currency: 'BRL',
        referenceExternalTransactionId: 'bet-123',
      });
      expect(txn.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);
    });

    test('creates OPENING transaction in PENDING status', () => {
      const txn = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.OPENING,
        amount: '100.00',
        currency: 'BRL',
        referenceExternalTransactionId: null,
      });
      expect(txn.status).toBe(WagerTransactionStatus.PENDING);
    });

    test('generates unique id', () => {
      const txn1 = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '10.00', currency: 'BRL', referenceExternalTransactionId: null });
      const txn2 = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '10.00', currency: 'BRL', referenceExternalTransactionId: null });
      expect(txn1.id).not.toBe(txn2.id);
    });
  });

  describe('Rehydration', () => {
    test('rehydrates transaction without validation', () => {
      const props = {
        id: 'txn-456',
        providerId: 'provider-1',
        externalTransactionId: 'txn-456',
        idempotencyKey: 'provider-1:txn-456',
        payloadHash: 'hash-def',
        walletId: 'wallet-1',
        playerId: 'player-1',
        roundId: 'round-1',
        gameId: 'game-1',
        kind: WagerTransactionKind.BET,
        amount: '25.00',
        currency: 'BRL',
        referenceExternalTransactionId: null,
        referenceTransactionId: 'ref-123',
        status: WagerTransactionStatus.PROCESSED,
        failureCode: null,
        processedAt: new Date('2024-01-15'),
        createdAt: new Date('2024-01-15'),
        updatedAt: new Date('2024-01-15'),
      };
      const txn = WagerTransaction.rehydrate(props);
      expect(txn.id).toBe('txn-456');
      expect(txn.status).toBe(WagerTransactionStatus.PROCESSED);
      expect(txn.referenceTransactionId).toBe('ref-123');
    });
  });

  describe('State Transitions', () => {
    test('marks transaction as processed', () => {
      const txn = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '50.00', currency: 'BRL', referenceExternalTransactionId: null });
      txn.markProcessed();
      expect(txn.status).toBe(WagerTransactionStatus.PROCESSED);
      expect(txn.processedAt).toBeInstanceOf(Date);
    });

    test('marks transaction as rejected with failure code', () => {
      const txn = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '50.00', currency: 'BRL', referenceExternalTransactionId: null });
      txn.markRejected('INSUFFICIENT_BALANCE');
      expect(txn.status).toBe(WagerTransactionStatus.REJECTED);
      expect(txn.failureCode).toBe('INSUFFICIENT_BALANCE');
    });

    test('marks transaction as failed', () => {
      const txn = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '50.00', currency: 'BRL', referenceExternalTransactionId: null });
      txn.markFailed('DATABASE_ERROR');
      expect(txn.status).toBe(WagerTransactionStatus.FAILED);
      expect(txn.failureCode).toBe('DATABASE_ERROR');
    });

    test('throws when marking terminal transaction as processed', () => {
      const txn = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '50.00', currency: 'BRL', referenceExternalTransactionId: null });
      txn.markProcessed();
      expect(() => txn.markProcessed()).toThrow('Cannot process a terminal transaction');
    });

    test('throws when marking terminal transaction as rejected', () => {
      const txn = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '50.00', currency: 'BRL', referenceExternalTransactionId: null });
      txn.markRejected('INSUFFICIENT_BALANCE');
      expect(() => txn.markRejected('OTHER_ERROR')).toThrow('Cannot reject a terminal transaction');
    });

    test('sets reference transaction id', () => {
      const txn = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.REFUND,
        amount: '50.00',
        currency: 'BRL',
        referenceExternalTransactionId: 'bet-123',
      });
      txn.setReferenceTransactionId('bet-txn-456');
      expect(txn.referenceTransactionId).toBe('bet-txn-456');
      expect(txn.status).toBe(WagerTransactionStatus.PENDING);
    });

    test('throws when setting reference transaction id twice', () => {
      const txn = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.REFUND,
        amount: '50.00',
        currency: 'BRL',
        referenceExternalTransactionId: 'bet-123',
      });
      txn.setReferenceTransactionId('bet-txn-456');
      expect(() => txn.setReferenceTransactionId('bet-txn-789')).toThrow('Reference transaction already set');
    });
  });

  describe('Terminal Status Check', () => {
    test('isTerminal returns true for PROCESSED', () => {
      const txn = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '50.00', currency: 'BRL', referenceExternalTransactionId: null });
      txn.markProcessed();
      expect(txn.isTerminal()).toBe(true);
    });

    test('isTerminal returns true for REJECTED', () => {
      const txn = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '50.00', currency: 'BRL', referenceExternalTransactionId: null });
      txn.markRejected('INSUFFICIENT_BALANCE');
      expect(txn.isTerminal()).toBe(true);
    });

    test('isTerminal returns true for FAILED', () => {
      const txn = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '50.00', currency: 'BRL', referenceExternalTransactionId: null });
      txn.markFailed('ERROR');
      expect(txn.isTerminal()).toBe(true);
    });

    test('isTerminal returns false for PENDING', () => {
      const txn = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '50.00', currency: 'BRL', referenceExternalTransactionId: null });
      expect(txn.isTerminal()).toBe(false);
    });

    test('isTerminal returns false for PENDING_REFERENCE', () => {
      const txn = WagerTransaction.create({
        ...baseProps,
        kind: WagerTransactionKind.REFUND,
        amount: '50.00',
        currency: 'BRL',
        referenceExternalTransactionId: 'bet-123',
      });
      expect(txn.isTerminal()).toBe(false);
    });
  });

  describe('Snapshot', () => {
    test('toSnapshot returns current state', () => {
      const txn = WagerTransaction.create({ ...baseProps, kind: WagerTransactionKind.BET, amount: '50.00', currency: 'BRL', referenceExternalTransactionId: null });
      txn.markProcessed();
      const snapshot = txn.toSnapshot();
      expect(snapshot.id).toBe(txn.id);
      expect(snapshot.status).toBe(WagerTransactionStatus.PROCESSED);
      expect(snapshot.amount).toBe('50.00');
    });
  });
});
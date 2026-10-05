import { test, expect, describe } from 'bun:test';
import { WalletLedgerEntry, LedgerDirection } from './wallet-ledger-entry';
import { Money } from '../money';

describe('WalletLedgerEntry', () => {
  describe('Creation', () => {
    test('creates DEBIT entry with valid balance transition', () => {
      const entry = WalletLedgerEntry.create({
        walletId: 'wallet-1',
        transactionId: 'txn-1',
        direction: LedgerDirection.DEBIT,
        amount: Money.from({ amount: '30.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '70.00', currency: 'BRL' }),
      });
      expect(entry.direction).toBe(LedgerDirection.DEBIT);
      expect(entry.amount.amount).toBe('30.00');
      expect(entry.balanceBefore.amount).toBe('100.00');
      expect(entry.balanceAfter.amount).toBe('70.00');
    });

    test('creates CREDIT entry with valid balance transition', () => {
      const entry = WalletLedgerEntry.create({
        walletId: 'wallet-1',
        transactionId: 'txn-1',
        direction: LedgerDirection.CREDIT,
        amount: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '100.00', currency: 'BRL' }),
      });
      expect(entry.direction).toBe(LedgerDirection.CREDIT);
      expect(entry.balanceAfter.amount).toBe('100.00');
    });

    test('throws on invalid DEBIT balance calculation', () => {
      expect(() =>
        WalletLedgerEntry.create({
          walletId: 'wallet-1',
          transactionId: 'txn-1',
          direction: LedgerDirection.DEBIT,
          amount: Money.from({ amount: '30.00', currency: 'BRL' }),
          balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
          balanceAfter: Money.from({ amount: '80.00', currency: 'BRL' }),
        })
      ).toThrow('Ledger entry validation failed');
    });

    test('throws on invalid CREDIT balance calculation', () => {
      expect(() =>
        WalletLedgerEntry.create({
          walletId: 'wallet-1',
          transactionId: 'txn-1',
          direction: LedgerDirection.CREDIT,
          amount: Money.from({ amount: '50.00', currency: 'BRL' }),
          balanceBefore: Money.from({ amount: '50.00', currency: 'BRL' }),
          balanceAfter: Money.from({ amount: '90.00', currency: 'BRL' }),
        })
      ).toThrow('Ledger entry validation failed');
    });

    test('throws on currency mismatch', () => {
      expect(() =>
        WalletLedgerEntry.create({
          walletId: 'wallet-1',
          transactionId: 'txn-1',
          direction: LedgerDirection.DEBIT,
          amount: Money.from({ amount: '30.00', currency: 'BRL' }),
          balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
          balanceAfter: Money.from({ amount: '70.00', currency: 'USD' }),
        })
      ).toThrow('All amounts must have the same currency');
    });
  });

  describe('Rehydration', () => {
    test('rehydrates entry without validation', () => {
      const entry = WalletLedgerEntry.rehydrate({
        id: 'entry-1',
        walletId: 'wallet-1',
        transactionId: 'txn-1',
        direction: LedgerDirection.DEBIT,
        amount: Money.rehydrate('30.00', 'BRL'),
        balanceBefore: Money.rehydrate('100.00', 'BRL'),
        balanceAfter: Money.rehydrate('70.00', 'BRL'),
        createdAt: new Date('2024-01-15'),
      });
      expect(entry.id).toBe('entry-1');
      expect(entry.direction).toBe(LedgerDirection.DEBIT);
    });
  });

  describe('Immutability', () => {
    test('entries cannot be modified after creation', () => {
      const entry = WalletLedgerEntry.create({
        walletId: 'wallet-1',
        transactionId: 'txn-1',
        direction: LedgerDirection.DEBIT,
        amount: Money.from({ amount: '30.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '100.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '70.00', currency: 'BRL' }),
      });

      expect(entry.id).toBeDefined();
      expect(entry.walletId).toBe('wallet-1');
      expect(entry.transactionId).toBe('txn-1');
    });
  });

  describe('Snapshot', () => {
    test('toSnapshot returns current state', () => {
      const entry = WalletLedgerEntry.create({
        walletId: 'wallet-1',
        transactionId: 'txn-1',
        direction: LedgerDirection.CREDIT,
        amount: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceBefore: Money.from({ amount: '50.00', currency: 'BRL' }),
        balanceAfter: Money.from({ amount: '100.00', currency: 'BRL' }),
      });
      const snapshot = entry.toSnapshot();
      expect(snapshot.id).toBe(entry.id);
      expect(snapshot.direction).toBe(LedgerDirection.CREDIT);
      expect(snapshot.amount.amount).toBe('50.00');
    });
  });
});
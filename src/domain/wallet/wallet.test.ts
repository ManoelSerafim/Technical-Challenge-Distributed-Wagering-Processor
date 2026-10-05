import { test, expect, describe } from 'bun:test';
import { Wallet, asPlayerId, asWalletId } from './wallet';
import { Money } from '../money';

describe('Wallet Aggregate Root', () => {
  const playerId = asPlayerId('player-123');

  describe('Creation', () => {
    test('creates wallet with initial balance', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '100.00', currency: 'BRL' }));
      expect(wallet.playerId).toBe(playerId);
      expect(wallet.currency).toBe('BRL');
      expect(wallet.balance.amount).toBe('100.00');
      expect(wallet.version).toBe(1);
    });

    test('creates wallet with zero balance by default', () => {
      const wallet = Wallet.create(playerId, 'BRL');
      expect(wallet.balance.amount).toBe('0.00');
      expect(wallet.balance.isZero()).toBe(true);
    });

    test('throws when initial balance currency differs', () => {
      expect(() =>
        Wallet.create(playerId, 'BRL', Money.from({ amount: '100.00', currency: 'USD' }))
      ).toThrow('Initial balance currency must match wallet currency');
    });

    test('sets createdAt and updatedAt on creation', () => {
      const wallet = Wallet.create(playerId, 'BRL');
      expect(wallet.createdAt).toBeInstanceOf(Date);
      expect(wallet.updatedAt).toBeInstanceOf(Date);
      expect(wallet.createdAt.getTime()).toBe(wallet.updatedAt.getTime());
    });
  });

  describe('Rehydration', () => {
    test('rehydrates wallet without validation', () => {
      const props = {
        id: asWalletId('wallet-123'),
        playerId,
        currency: 'BRL',
        balance: Money.rehydrate('50.00', 'BRL'),
        version: 5,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-10'),
      };
      const wallet = Wallet.rehydrate(props);
      expect(String(wallet.id)).toBe('wallet-123');
      expect(wallet.balance.amount).toBe('50.00');
      expect(wallet.version).toBe(5);
    });
  });

  describe('Debit Operations', () => {
    test('debits amount successfully', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '100.00', currency: 'BRL' }));
      const newBalance = wallet.debit(Money.from({ amount: '30.00', currency: 'BRL' }));
      expect(newBalance.amount).toBe('70.00');
      expect(wallet.version).toBe(2);
    });

    test('throws on insufficient balance', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '50.00', currency: 'BRL' }));
      expect(() => wallet.debit(Money.from({ amount: '100.00', currency: 'BRL' }))).toThrow('Insufficient balance');
      expect(wallet.balance.amount).toBe('50.00');
      expect(wallet.version).toBe(1);
    });

    test('throws on currency mismatch', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '100.00', currency: 'BRL' }));
      expect(() => wallet.debit(Money.from({ amount: '30.00', currency: 'USD' }))).toThrow('Currency mismatch');
    });

    test('allows debit resulting in zero balance', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '50.00', currency: 'BRL' }));
      const newBalance = wallet.debit(Money.from({ amount: '50.00', currency: 'BRL' }));
      expect(newBalance.isZero()).toBe(true);
      expect(wallet.version).toBe(2);
    });

    test('increments version on successful debit', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '100.00', currency: 'BRL' }));
      wallet.debit(Money.from({ amount: '10.00', currency: 'BRL' }));
      wallet.debit(Money.from({ amount: '20.00', currency: 'BRL' }));
      expect(wallet.version).toBe(3);
    });

    test('updates updatedAt on debit', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '100.00', currency: 'BRL' }));
      const before = wallet.updatedAt;
      wallet.debit(Money.from({ amount: '10.00', currency: 'BRL' }));
      expect(wallet.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('Credit Operations', () => {
    test('credits amount successfully', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '50.00', currency: 'BRL' }));
      const newBalance = wallet.credit(Money.from({ amount: '30.00', currency: 'BRL' }));
      expect(newBalance.amount).toBe('80.00');
      expect(wallet.version).toBe(2);
    });

    test('throws on currency mismatch', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '50.00', currency: 'BRL' }));
      expect(() => wallet.credit(Money.from({ amount: '30.00', currency: 'USD' }))).toThrow('Currency mismatch');
    });

    test('increments version on successful credit', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '50.00', currency: 'BRL' }));
      wallet.credit(Money.from({ amount: '10.00', currency: 'BRL' }));
      wallet.credit(Money.from({ amount: '20.00', currency: 'BRL' }));
      expect(wallet.version).toBe(3);
    });

    test('updates updatedAt on credit', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '50.00', currency: 'BRL' }));
      const before = wallet.updatedAt;
      wallet.credit(Money.from({ amount: '10.00', currency: 'BRL' }));
      expect(wallet.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('Snapshot', () => {
    test('toSnapshot returns current state', () => {
      const wallet = Wallet.create(playerId, 'BRL', Money.from({ amount: '100.00', currency: 'BRL' }));
      wallet.debit(Money.from({ amount: '30.00', currency: 'BRL' }));
      const snapshot = wallet.toSnapshot();
      expect(snapshot.id).toBe(wallet.id);
      expect(snapshot.playerId).toBe(playerId);
      expect(snapshot.currency).toBe('BRL');
      expect(snapshot.balance.amount).toBe('70.00');
      expect(snapshot.version).toBe(2);
    });
  });
});
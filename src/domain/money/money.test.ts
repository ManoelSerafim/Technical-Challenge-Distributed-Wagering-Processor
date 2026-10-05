import { test, expect, describe } from 'bun:test';
import { Money } from './money';

describe('Money Value Object', () => {
  describe('Creation', () => {
    test('creates money from valid amount and currency', () => {
      const money = Money.from({ amount: '25.00', currency: 'BRL' });
      expect(money.amount).toBe('25.00');
      expect(money.currency).toBe('BRL');
    });

    test('normalizes currency to uppercase', () => {
      const money = Money.from({ amount: '10.00', currency: 'brl' });
      expect(money.currency).toBe('BRL');
    });

    test('creates zero money', () => {
      const money = Money.zero('BRL');
      expect(money.amount).toBe('0.00');
      expect(money.currency).toBe('BRL');
      expect(money.isZero()).toBe(true);
    });

    test('throws on missing amount', () => {
      expect(() => Money.from({ amount: '', currency: 'BRL' })).toThrow('Amount and currency are required');
    });

    test('throws on missing currency', () => {
      expect(() => Money.from({ amount: '10.00', currency: '' })).toThrow('Amount and currency are required');
    });

    test('throws on invalid amount format', () => {
      expect(() => Money.from({ amount: 'abc', currency: 'BRL' })).toThrow('Invalid amount format');
    });

    test('throws on scale exceeding 2 decimals', () => {
      expect(() => Money.from({ amount: '10.123', currency: 'BRL' })).toThrow('Amount scale exceeds 2 decimal places');
    });

    test('throws on invalid currency code', () => {
      expect(() => Money.from({ amount: '10.00', currency: 'BR' })).toThrow('Currency must be a valid 3-letter ISO code');
    });

    test('accepts integer amounts', () => {
      const money = Money.from({ amount: '100', currency: 'BRL' });
      expect(money.amount).toBe('100');
    });

    test('accepts negative amounts', () => {
      const money = Money.from({ amount: '-25.00', currency: 'BRL' });
      expect(money.amount).toBe('-25.00');
      expect(money.isNegative()).toBe(true);
    });
  });

  describe('Arithmetic Operations', () => {
    test('adds two positive amounts', () => {
      const a = Money.from({ amount: '10.00', currency: 'BRL' });
      const b = Money.from({ amount: '20.00', currency: 'BRL' });
      const result = a.add(b);
      expect(result.amount).toBe('30.00');
    });

    test('adds positive and negative amounts', () => {
      const a = Money.from({ amount: '50.00', currency: 'BRL' });
      const b = Money.from({ amount: '-20.00', currency: 'BRL' });
      const result = a.add(b);
      expect(result.amount).toBe('30.00');
    });

    test('adds two negative amounts', () => {
      const a = Money.from({ amount: '-10.00', currency: 'BRL' });
      const b = Money.from({ amount: '-20.00', currency: 'BRL' });
      const result = a.add(b);
      expect(result.amount).toBe('-30.00');
    });

    test('subtracts amounts', () => {
      const a = Money.from({ amount: '50.00', currency: 'BRL' });
      const b = Money.from({ amount: '20.00', currency: 'BRL' });
      const result = a.subtract(b);
      expect(result.amount).toBe('30.00');
    });

    test('subtracts larger from smaller (negative result)', () => {
      const a = Money.from({ amount: '20.00', currency: 'BRL' });
      const b = Money.from({ amount: '50.00', currency: 'BRL' });
      const result = a.subtract(b);
      expect(result.amount).toBe('-30.00');
    });

    test('negates positive amount', () => {
      const money = Money.from({ amount: '25.00', currency: 'BRL' });
      const negated = money.negate();
      expect(negated.amount).toBe('-25.00');
    });

    test('negates negative amount', () => {
      const money = Money.from({ amount: '-25.00', currency: 'BRL' });
      const negated = money.negate();
      expect(negated.amount).toBe('25.00');
    });

    test('throws on currency mismatch in add', () => {
      const a = Money.from({ amount: '10.00', currency: 'BRL' });
      const b = Money.from({ amount: '20.00', currency: 'USD' });
      expect(() => a.add(b)).toThrow('Currency mismatch');
    });

    test('throws on currency mismatch in subtract', () => {
      const a = Money.from({ amount: '10.00', currency: 'BRL' });
      const b = Money.from({ amount: '20.00', currency: 'USD' });
      expect(() => a.subtract(b)).toThrow('Currency mismatch');
    });
  });

  describe('Comparison Operations', () => {
    test('isZero returns true for zero', () => {
      expect(Money.zero('BRL').isZero()).toBe(true);
      expect(Money.from({ amount: '0.00', currency: 'BRL' }).isZero()).toBe(true);
      expect(Money.from({ amount: '0', currency: 'BRL' }).isZero()).toBe(true);
    });

    test('isZero returns false for non-zero', () => {
      expect(Money.from({ amount: '0.01', currency: 'BRL' }).isZero()).toBe(false);
      expect(Money.from({ amount: '-0.01', currency: 'BRL' }).isZero()).toBe(false);
    });

    test('isPositive returns true for positive', () => {
      expect(Money.from({ amount: '10.00', currency: 'BRL' }).isPositive()).toBe(true);
    });

    test('isPositive returns false for zero and negative', () => {
      expect(Money.zero('BRL').isPositive()).toBe(false);
      expect(Money.from({ amount: '-10.00', currency: 'BRL' }).isPositive()).toBe(false);
    });

    test('isNegative returns true for negative', () => {
      expect(Money.from({ amount: '-10.00', currency: 'BRL' }).isNegative()).toBe(true);
    });

    test('isNegative returns false for zero and positive', () => {
      expect(Money.zero('BRL').isNegative()).toBe(false);
      expect(Money.from({ amount: '10.00', currency: 'BRL' }).isNegative()).toBe(false);
    });

    test('isLessThan compares correctly', () => {
      const a = Money.from({ amount: '10.00', currency: 'BRL' });
      const b = Money.from({ amount: '20.00', currency: 'BRL' });
      expect(a.isLessThan(b)).toBe(true);
      expect(b.isLessThan(a)).toBe(false);
    });

    test('isLessThan with negative numbers', () => {
      const a = Money.from({ amount: '-20.00', currency: 'BRL' });
      const b = Money.from({ amount: '-10.00', currency: 'BRL' });
      expect(a.isLessThan(b)).toBe(true);
    });

    test('equals returns true for same amount and currency', () => {
      const a = Money.from({ amount: '25.00', currency: 'BRL' });
      const b = Money.from({ amount: '25.00', currency: 'BRL' });
      expect(a.equals(b)).toBe(true);
    });

    test('equals returns false for different amount', () => {
      const a = Money.from({ amount: '25.00', currency: 'BRL' });
      const b = Money.from({ amount: '30.00', currency: 'BRL' });
      expect(a.equals(b)).toBe(false);
    });

    test('equals returns false for different currency', () => {
      const a = Money.from({ amount: '25.00', currency: 'BRL' });
      const b = Money.from({ amount: '25.00', currency: 'USD' });
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('Rehydration', () => {
    test('rehydrate creates money without validation', () => {
      const money = Money.rehydrate('25.00', 'BRL');
      expect(money.amount).toBe('25.00');
      expect(money.currency).toBe('BRL');
    });
  });

  describe('Serialization', () => {
    test('toJSON returns correct structure', () => {
      const money = Money.from({ amount: '25.00', currency: 'BRL' });
      expect(money.toJSON()).toEqual({ amount: '25.00', currency: 'BRL' });
    });

    test('toString returns formatted string', () => {
      const money = Money.from({ amount: '25.00', currency: 'BRL' });
      expect(money.toString()).toBe('25.00 BRL');
    });
  });
});
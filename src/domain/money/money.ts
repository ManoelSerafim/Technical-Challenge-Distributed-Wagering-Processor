export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private readonly _amount: string;
  private readonly _currency: string;

  private constructor(amount: string, currency: string) {
    this._amount = amount;
    this._currency = currency;
  }

  static from(props: MoneyProps): Money {
    const { amount, currency } = props;

    if (!amount || !currency) {
      throw new Error('Amount and currency are required');
    }

    const normalizedAmount = Money.normalizeAmount(amount);
    Money.validateScale(normalizedAmount);
    Money.validateCurrency(currency);

    return new Money(normalizedAmount, currency.toUpperCase());
  }

  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  static rehydrate(amount: string, currency: string): Money {
    return new Money(amount, currency);
  }

  private static normalizeAmount(amount: string): string {
    const trimmed = amount.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error('Invalid amount format');
    }
    return trimmed;
  }

  private static validateScale(amount: string): void {
    const parts = amount.split('.');
    const decimals = parts[1];
    if (parts.length === 2 && decimals && decimals.length > 2) {
      throw new Error('Amount scale exceeds 2 decimal places');
    }
  }

  private static validateCurrency(currency: string): void {
    if (!/^[A-Z]{3}$/.test(currency.toUpperCase())) {
      throw new Error('Currency must be a valid 3-letter ISO code');
    }
  }

  get amount(): string {
    return this._amount;
  }

  get currency(): string {
    return this._currency;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.addStrings(this._amount, other._amount);
    return new Money(result, this._currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    const result = this.subtractStrings(this._amount, other._amount);
    return new Money(result, this._currency);
  }

  negate(): Money {
    const negated = this._amount.startsWith('-')
      ? this._amount.slice(1)
      : `-${this._amount}`;
    return new Money(negated, this._currency);
  }

  isZero(): boolean {
    return this._amount === '0' || this._amount === '0.00' || this._amount === '0.0';
  }

  isPositive(): boolean {
    return !this._amount.startsWith('-') && !this.isZero();
  }

  isNegative(): boolean {
    return this._amount.startsWith('-');
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.compareStrings(this._amount, other._amount) < 0;
  }

  equals(other: Money): boolean {
    return this._amount === other._amount && this._currency === other._currency;
  }

  private assertSameCurrency(other: Money): void {
    if (this._currency !== other._currency) {
      throw new Error(`Currency mismatch: ${this._currency} vs ${other._currency}`);
    }
  }

  private compareStrings(a: string, b: string): number {
    const aNeg = a.startsWith('-');
    const bNeg = b.startsWith('-');

    if (aNeg && !bNeg) return -1;
    if (!aNeg && bNeg) return 1;

    const aAbs = aNeg ? a.slice(1) : a;
    const bAbs = bNeg ? b.slice(1) : b;

    const aParts = aAbs.split('.');
    const bParts = bAbs.split('.');

    const aInt = aParts[0] ?? '0';
    const bInt = bParts[0] ?? '0';
    const aDec = (aParts[1] ?? '').padEnd(2, '0');
    const bDec = (bParts[1] ?? '').padEnd(2, '0');

    const aFull = aInt.padStart(20, '0') + aDec;
    const bFull = bInt.padStart(20, '0') + bDec;

    if (aFull < bFull) return aNeg ? 1 : -1;
    if (aFull > bFull) return aNeg ? -1 : 1;
    return 0;
  }

  private addStrings(a: string, b: string): string {
    const aNeg = a.startsWith('-');
    const bNeg = b.startsWith('-');

    if (aNeg && bNeg) {
      return `-${this.addAbsolute(a.slice(1), b.slice(1))}`;
    }
    if (aNeg) {
      return this.subtractAbsolute(b, a.slice(1));
    }
    if (bNeg) {
      return this.subtractAbsolute(a, b.slice(1));
    }
    return this.addAbsolute(a, b);
  }

  private subtractStrings(a: string, b: string): string {
    const bNeg = b.startsWith('-');
    if (bNeg) {
      return this.addStrings(a, b.slice(1));
    }
    return this.addStrings(a, `-${b}`);
  }

  private addAbsolute(a: string, b: string): string {
    const aParts = a.split('.');
    const bParts = b.split('.');

    const aInt = aParts[0] ?? '0';
    const bInt = bParts[0] ?? '0';
    const aDec = (aParts[1] ?? '').padEnd(2, '0');
    const bDec = (bParts[1] ?? '').padEnd(2, '0');

    const aFull = BigInt(aInt.padStart(20, '0') + aDec);
    const bFull = BigInt(bInt.padStart(20, '0') + bDec);
    const result = aFull + bFull;

    const resultStr = result.toString().padStart(22, '0');
    const intPart = resultStr.slice(0, -2).replace(/^0+/, '') || '0';
    const decPart = resultStr.slice(-2);

    return `${intPart}.${decPart}`;
  }

  private subtractAbsolute(a: string, b: string): string {
    const aParts = a.split('.');
    const bParts = b.split('.');

    const aInt = aParts[0] ?? '0';
    const bInt = bParts[0] ?? '0';
    const aDec = (aParts[1] ?? '').padEnd(2, '0');
    const bDec = (bParts[1] ?? '').padEnd(2, '0');

    const aFull = BigInt(aInt.padStart(20, '0') + aDec);
    const bFull = BigInt(bInt.padStart(20, '0') + bDec);

    if (aFull >= bFull) {
      const result = aFull - bFull;
      const resultStr = result.toString().padStart(22, '0');
      const intPart = resultStr.slice(0, -2).replace(/^0+/, '') || '0';
      const decPart = resultStr.slice(-2);
      return `${intPart}.${decPart}`;
    } else {
      const result = bFull - aFull;
      const resultStr = result.toString().padStart(22, '0');
      const intPart = resultStr.slice(0, -2).replace(/^0+/, '') || '0';
      const decPart = resultStr.slice(-2);
      return `-${intPart}.${decPart}`;
    }
  }

  toString(): string {
    return `${this._amount} ${this._currency}`;
  }

  toJSON(): MoneyProps {
    return {
      amount: this._amount,
      currency: this._currency,
    };
  }
}
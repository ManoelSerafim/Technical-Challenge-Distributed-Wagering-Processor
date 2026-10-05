import { Money } from '../money';
import { v4 as uuidv4 } from 'uuid';

export type WalletId = string & { readonly __brand: unique symbol };
export type PlayerId = string & { readonly __brand: unique symbol };

export function asWalletId(id: string): WalletId {
  return id as WalletId;
}

export function asPlayerId(id: string): PlayerId {
  return id as PlayerId;
}

export interface WalletProps {
  id: WalletId;
  playerId: PlayerId;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private readonly _id: WalletId;
  private readonly _playerId: PlayerId;
  private readonly _currency: string;
  private _balance: Money;
  private _version: number;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  private constructor(props: WalletProps) {
    this._id = props.id;
    this._playerId = props.playerId;
    this._currency = props.currency;
    this._balance = props.balance;
    this._version = props.version;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  static create(playerId: PlayerId, currency: string, initialBalance: Money = Money.zero(currency)): Wallet {
    if (initialBalance.currency !== currency) {
      throw new Error('Initial balance currency must match wallet currency');
    }

    const now = new Date();
    return new Wallet({
      id: uuidv4() as WalletId,
      playerId,
      currency: currency.toUpperCase(),
      balance: initialBalance,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(props: WalletProps): Wallet {
    return new Wallet(props);
  }

  get id(): WalletId {
    return this._id;
  }

  get playerId(): PlayerId {
    return this._playerId;
  }

  get currency(): string {
    return this._currency;
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  debit(amount: Money): Money {
    this.assertSameCurrency(amount);
    const newBalance = this._balance.subtract(amount);
    if (newBalance.isNegative()) {
      throw new Error('Insufficient balance');
    }
    this._balance = newBalance;
    this._version++;
    this._updatedAt = new Date();
    return this._balance;
  }

  credit(amount: Money): Money {
    this.assertSameCurrency(amount);
    this._balance = this._balance.add(amount);
    this._version++;
    this._updatedAt = new Date();
    return this._balance;
  }

  private assertSameCurrency(amount: Money): void {
    if (this._currency !== amount.currency) {
      throw new Error(`Currency mismatch: wallet ${this._currency} vs amount ${amount.currency}`);
    }
  }

  toSnapshot(): WalletProps {
    return {
      id: this._id,
      playerId: this._playerId,
      currency: this._currency,
      balance: this._balance,
      version: this._version,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    };
  }
}
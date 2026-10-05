import { Money } from '../money';

export enum LedgerDirection {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

export interface WalletLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export class WalletLedgerEntry {
  private readonly _id!: string;
  private readonly _walletId!: string;
  private readonly _transactionId!: string;
  private readonly _direction!: LedgerDirection;
  private readonly _amount!: Money;
  private readonly _balanceBefore!: Money;
  private readonly _balanceAfter!: Money;
  private readonly _createdAt!: Date;

  private constructor(props: WalletLedgerEntryProps) {
    WalletLedgerEntry.validate(props.balanceBefore, props.amount, props.direction, props.balanceAfter);
    Object.assign(this, {
      _id: props.id,
      _walletId: props.walletId,
      _transactionId: props.transactionId,
      _direction: props.direction,
      _amount: props.amount,
      _balanceBefore: props.balanceBefore,
      _balanceAfter: props.balanceAfter,
      _createdAt: props.createdAt,
    });
  }

  static create(props: {
    walletId: string;
    transactionId: string;
    direction: LedgerDirection;
    amount: Money;
    balanceBefore: Money;
    balanceAfter: Money;
  }): WalletLedgerEntry {
    return new WalletLedgerEntry({
      id: crypto.randomUUID(),
      walletId: props.walletId,
      transactionId: props.transactionId,
      direction: props.direction,
      amount: props.amount,
      balanceBefore: props.balanceBefore,
      balanceAfter: props.balanceAfter,
      createdAt: new Date(),
    });
  }

  static rehydrate(props: WalletLedgerEntryProps): WalletLedgerEntry {
    return new WalletLedgerEntry(props);
  }

  private static validate(
    balanceBefore: Money,
    amount: Money,
    direction: LedgerDirection,
    balanceAfter: Money
  ): void {
    if (balanceBefore.currency !== amount.currency || amount.currency !== balanceAfter.currency) {
      throw new Error('All amounts must have the same currency');
    }

    let expected: Money;
    if (direction === LedgerDirection.DEBIT) {
      expected = balanceBefore.subtract(amount);
    } else {
      expected = balanceBefore.add(amount);
    }

    if (!expected.equals(balanceAfter)) {
      throw new Error(
        `Ledger entry validation failed: ${balanceBefore.amount} ${direction} ${amount.amount} != ${balanceAfter.amount}`
      );
    }
  }

  get id(): string {
    return this._id;
  }

  get walletId(): string {
    return this._walletId;
  }

  get transactionId(): string {
    return this._transactionId;
  }

  get direction(): LedgerDirection {
    return this._direction;
  }

  get amount(): Money {
    return this._amount;
  }

  get balanceBefore(): Money {
    return this._balanceBefore;
  }

  get balanceAfter(): Money {
    return this._balanceAfter;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  toSnapshot(): WalletLedgerEntryProps {
    return {
      id: this._id,
      walletId: this._walletId,
      transactionId: this._transactionId,
      direction: this._direction,
      amount: this._amount,
      balanceBefore: this._balanceBefore,
      balanceAfter: this._balanceAfter,
      createdAt: this._createdAt,
    };
  }
}
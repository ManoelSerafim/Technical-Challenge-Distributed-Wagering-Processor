import { Entity, PrimaryKey, Property, Index, Enum, ManyToOne } from '@mikro-orm/core';
import type { LedgerDirection } from '@domain/ledger';
import { WalletLedgerEntry, LedgerDirection as LedgerDirectionEnum } from '@domain/ledger';
import { WalletEntity } from './wallet.entity';
import { WagerTransactionEntity } from './wager-transaction.entity';
import { Money } from '@domain/money';

@Entity({ tableName: 'ledger_entries' })
@Index({ properties: ['wallet', 'createdAt'] })
@Index({ properties: ['transaction', 'createdAt'] })
export class LedgerEntryEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @ManyToOne(() => WalletEntity, { fieldName: 'wallet_id', deleteRule: 'cascade' })
  wallet!: WalletEntity;

  @ManyToOne(() => WagerTransactionEntity, { fieldName: 'transaction_id', deleteRule: 'cascade' })
  transaction!: WagerTransactionEntity;

  @Enum(() => LedgerDirectionEnum)
  direction!: LedgerDirection;

  @Property({ type: 'numeric(14,2)', precision: 14, scale: 2 })
  amount!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({ type: 'numeric(14,2)', precision: 14, scale: 2 })
  balanceBefore!: string;

  @Property({ type: 'numeric(14,2)', precision: 14, scale: 2 })
  balanceAfter!: string;

  @Property({ onCreate: () => new Date() })
  createdAt!: Date;

  get walletId(): string {
    return this.wallet?.id;
  }

  get transactionId(): string {
    return this.transaction?.id;
  }

  toDomain(): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: this.id,
      walletId: this.walletId,
      transactionId: this.transactionId,
      direction: this.direction,
      amount: Money.rehydrate(this.amount, this.currency),
      balanceBefore: Money.rehydrate(this.balanceBefore, this.currency),
      balanceAfter: Money.rehydrate(this.balanceAfter, this.currency),
      createdAt: this.createdAt,
    });
  }

  static fromDomain(entry: WalletLedgerEntry): LedgerEntryEntity {
    const entity = new LedgerEntryEntity();
    const snapshot = entry.toSnapshot();
    entity.id = snapshot.id;
    entity.wallet = undefined as unknown as WalletEntity;
    entity.transaction = undefined as unknown as WagerTransactionEntity;
    entity.direction = snapshot.direction;
    entity.amount = snapshot.amount.amount;
    entity.currency = snapshot.amount.currency;
    entity.balanceBefore = snapshot.balanceBefore.amount;
    entity.balanceAfter = snapshot.balanceAfter.amount;
    entity.createdAt = snapshot.createdAt;
    return entity;
  }
}
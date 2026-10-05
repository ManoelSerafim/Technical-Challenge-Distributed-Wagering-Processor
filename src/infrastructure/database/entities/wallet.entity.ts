import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/core';
import type { WalletId, PlayerId } from '@domain/wallet';
import { Wallet } from '@domain/wallet';
import { Money } from '@domain/money';

@Entity({ tableName: 'wallets' })
@Unique({ properties: ['playerId', 'currency'] })
@Index({ properties: ['playerId'] })
export class WalletEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: WalletId;

  @Property({ type: 'uuid' })
  playerId!: PlayerId;

  @Property({ length: 3 })
  currency!: string;

  @Property({ type: 'numeric(14,2)', precision: 14, scale: 2 })
  balance!: string;

  @Property({ type: 'int' })
  version!: number;

  @Property({ onCreate: () => new Date() })
  createdAt!: Date;

  @Property({ onUpdate: () => new Date() })
  updatedAt!: Date;

  toDomain(): Wallet {
    return Wallet.rehydrate({
      id: this.id,
      playerId: this.playerId,
      currency: this.currency,
      balance: Money.rehydrate(this.balance, this.currency),
      version: this.version,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }

  static fromDomain(wallet: Wallet): WalletEntity {
    const entity = new WalletEntity();
    const snapshot = wallet.toSnapshot();
    entity.id = snapshot.id;
    entity.playerId = snapshot.playerId;
    entity.currency = snapshot.currency;
    entity.balance = snapshot.balance.amount;
    entity.version = snapshot.version;
    entity.createdAt = snapshot.createdAt;
    entity.updatedAt = snapshot.updatedAt;
    return entity;
  }

  updateFromDomain(wallet: Wallet): void {
    const snapshot = wallet.toSnapshot();
    this.balance = snapshot.balance.amount;
    this.version = snapshot.version;
    this.updatedAt = snapshot.updatedAt;
  }
}
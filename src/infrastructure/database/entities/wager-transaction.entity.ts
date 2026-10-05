import { Entity, PrimaryKey, Property, Index, Enum, ManyToOne } from '@mikro-orm/core';
import type { WagerTransactionKind, WagerTransactionStatus } from '@domain/wager';
import { WagerTransaction, WagerTransactionKind as WagerTransactionKindEnum, WagerTransactionStatus as WagerTransactionStatusEnum } from '@domain/wager';
import { WalletEntity } from './wallet.entity';

@Entity({ tableName: 'wager_transactions' })
@Index({ properties: ['providerId', 'externalTransactionId'] })
@Index({ properties: ['idempotencyKey'] })
@Index({ properties: ['walletId', 'status'] })
@Index({ properties: ['referenceExternalTransactionId'] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ length: 100 })
  providerId!: string;

  @Property({ length: 200 })
  externalTransactionId!: string;

  @Property({ length: 400 })
  idempotencyKey!: string;

  @Property({ length: 64 })
  payloadHash!: string;

  @ManyToOne(() => WalletEntity, { fieldName: 'wallet_id', deleteRule: 'cascade' })
  wallet!: WalletEntity;

  @Property({ type: 'uuid' })
  walletId!: string;

  @Property({ type: 'uuid' })
  playerId!: string;

  @Property({ length: 100, nullable: true })
  roundId!: string | null;

  @Property({ length: 100, nullable: true })
  gameId!: string | null;

  @Enum(() => WagerTransactionKindEnum)
  kind!: WagerTransactionKind;

  @Property({ type: 'numeric(14,2)', precision: 14, scale: 2 })
  amount!: string;

  @Property({ length: 3 })
  currency!: string;

  @Property({ length: 200, nullable: true })
  referenceExternalTransactionId!: string | null;

  @Property({ type: 'uuid', nullable: true })
  referenceTransactionId!: string | null;

  @Enum(() => WagerTransactionStatusEnum)
  status!: WagerTransactionStatus;

  @Property({ length: 50, nullable: true })
  failureCode!: string | null;

  @Property({ nullable: true })
  processedAt!: Date | null;

  @Property({ onCreate: () => new Date() })
  createdAt!: Date;

  @Property({ onUpdate: () => new Date() })
  updatedAt!: Date;

  toDomain(): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: this.id,
      providerId: this.providerId,
      externalTransactionId: this.externalTransactionId,
      idempotencyKey: this.idempotencyKey,
      payloadHash: this.payloadHash,
      walletId: this.walletId,
      playerId: this.playerId,
      roundId: this.roundId,
      gameId: this.gameId,
      kind: this.kind,
      amount: this.amount,
      currency: this.currency,
      referenceExternalTransactionId: this.referenceExternalTransactionId,
      referenceTransactionId: this.referenceTransactionId,
      status: this.status,
      failureCode: this.failureCode,
      processedAt: this.processedAt,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    });
  }

  static fromDomain(transaction: WagerTransaction): WagerTransactionEntity {
    const entity = new WagerTransactionEntity();
    const snapshot = transaction.toSnapshot();
    entity.id = snapshot.id;
    entity.providerId = snapshot.providerId;
    entity.externalTransactionId = snapshot.externalTransactionId;
    entity.idempotencyKey = snapshot.idempotencyKey;
    entity.payloadHash = snapshot.payloadHash;
    entity.walletId = snapshot.walletId;
    entity.playerId = snapshot.playerId;
    entity.roundId = snapshot.roundId;
    entity.gameId = snapshot.gameId;
    entity.kind = snapshot.kind;
    entity.amount = snapshot.amount;
    entity.currency = snapshot.currency;
    entity.referenceExternalTransactionId = snapshot.referenceExternalTransactionId;
    entity.referenceTransactionId = snapshot.referenceTransactionId;
    entity.status = snapshot.status;
    entity.failureCode = snapshot.failureCode;
    entity.processedAt = snapshot.processedAt;
    entity.createdAt = snapshot.createdAt;
    entity.updatedAt = snapshot.updatedAt;
    return entity;
  }

  updateFromDomain(transaction: WagerTransaction): void {
    const snapshot = transaction.toSnapshot();
    this.referenceTransactionId = snapshot.referenceTransactionId;
    this.status = snapshot.status;
    this.failureCode = snapshot.failureCode;
    this.processedAt = snapshot.processedAt;
    this.updatedAt = snapshot.updatedAt;
  }
}
import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { WagerTransaction, WagerTransactionStatus } from '@domain/wager';
import { WagerTransactionEntity } from '../entities/wager-transaction.entity';

export class WagerTransactionRepositoryImpl {
  private readonly repo: EntityRepository<WagerTransactionEntity>;

  constructor(private readonly em: EntityManager) {
    this.repo = em.getRepository(WagerTransactionEntity);
  }

  async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    const entity = await this.repo.findOne({ idempotencyKey: key });
    return entity ? entity.toDomain() : null;
  }

  async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.repo.findOne({ id });
    return entity ? entity.toDomain() : null;
  }

  async findByExternalReference(walletId: string, externalTransactionId: string): Promise<WagerTransaction | null> {
    const entity = await this.repo.findOne({ walletId, externalTransactionId });
    return entity ? entity.toDomain() : null;
  }

  async findPendingReferenceByExternalRef(walletId: string, referenceExternalTransactionId: string): Promise<WagerTransaction | null> {
    const entity = await this.repo.findOne({
      walletId,
      referenceExternalTransactionId,
      status: WagerTransactionStatus.PENDING_REFERENCE,
    });
    return entity ? entity.toDomain() : null;
  }

  async save(transaction: WagerTransaction): Promise<void> {
    const entity = WagerTransactionEntity.fromDomain(transaction);
    await this.em.persistAndFlush(entity);
  }

  async saveInTransaction(transaction: WagerTransaction, em: EntityManager): Promise<void> {
    const repo = em.getRepository(WagerTransactionEntity);
    const existing = await repo.findOne({ id: transaction.id });
    if (existing) {
      existing.updateFromDomain(transaction);
    } else {
      const entity = WagerTransactionEntity.fromDomain(transaction);
      em.persist(entity);
    }
  }
}
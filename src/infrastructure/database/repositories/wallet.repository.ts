import { EntityManager, LockMode, EntityRepository } from '@mikro-orm/core';
import { Wallet, WalletId, PlayerId } from '@domain/wallet';
import { WalletEntity } from '../entities/wallet.entity';

export class WalletRepositoryImpl {
  private readonly repo: EntityRepository<WalletEntity>;

  constructor(private readonly em: EntityManager) {
    this.repo = em.getRepository(WalletEntity);
  }

  async findById(id: WalletId): Promise<Wallet | null> {
    const entity = await this.repo.findOne({ id });
    return entity ? entity.toDomain() : null;
  }

  async findByIdLocked(id: WalletId, em: EntityManager): Promise<Wallet | null> {
    const repo = em.getRepository(WalletEntity);
    const entity = await repo.findOne({ id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
    return entity ? entity.toDomain() : null;
  }

  async findByPlayerIdAndCurrency(playerId: PlayerId, currency: string): Promise<Wallet | null> {
    const entity = await this.repo.findOne({ playerId, currency: currency.toUpperCase() });
    return entity ? entity.toDomain() : null;
  }

  async save(wallet: Wallet): Promise<void> {
    const entity = WalletEntity.fromDomain(wallet);
    await this.em.persistAndFlush(entity);
  }

  async saveInTransaction(wallet: Wallet, em: EntityManager): Promise<void> {
    const repo = em.getRepository(WalletEntity);
    const existing = await repo.findOne({ id: wallet.id });
    if (existing) {
      existing.updateFromDomain(wallet);
    } else {
      const entity = WalletEntity.fromDomain(wallet);
      em.persist(entity);
    }
  }
}
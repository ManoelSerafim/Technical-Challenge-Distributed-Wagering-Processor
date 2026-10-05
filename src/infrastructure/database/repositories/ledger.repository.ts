import { EntityManager } from '@mikro-orm/core';
import { WalletLedgerEntry } from '@domain/ledger';
import { LedgerEntryEntity } from '../entities/ledger-entry.entity';

export class LedgerRepositoryImpl {
  constructor(private readonly em: EntityManager) {}

  async findByWalletId(walletId: string): Promise<WalletLedgerEntry[]> {
    const entities = await this.em.getRepository(LedgerEntryEntity).find({ walletId }, { orderBy: { createdAt: 'ASC' } });
    return entities.map(e => e.toDomain());
  }

  async save(entry: WalletLedgerEntry): Promise<void> {
    const entity = LedgerEntryEntity.fromDomain(entry);
    await this.em.persistAndFlush(entity);
  }

  async saveInTransaction(entry: WalletLedgerEntry, em: EntityManager): Promise<void> {
    const entity = LedgerEntryEntity.fromDomain(entry);
    em.persist(entity);
  }
}
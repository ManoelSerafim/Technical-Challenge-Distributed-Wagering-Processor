import { EntityManager } from '@mikro-orm/core';
import { OutboxMessageEntity } from '../entities/outbox-message.entity';

export class OutboxRepositoryImpl {
  constructor(private readonly em: EntityManager) {}

  async save(aggregateId: string, eventType: string, payload: Record<string, unknown>): Promise<void> {
    const entity = new OutboxMessageEntity();
    entity.id = crypto.randomUUID();
    entity.aggregateId = aggregateId;
    entity.eventType = eventType;
    entity.payload = payload;
    entity.occurredAt = new Date();
    entity.attempts = 0;
    entity.nextAttemptAt = new Date();
    await this.em.persistAndFlush(entity);
  }

  async saveInTransaction(aggregateId: string, eventType: string, payload: Record<string, unknown>, em: EntityManager): Promise<void> {
    const entity = new OutboxMessageEntity();
    entity.id = crypto.randomUUID();
    entity.aggregateId = aggregateId;
    entity.eventType = eventType;
    entity.payload = payload;
    entity.occurredAt = new Date();
    entity.attempts = 0;
    entity.nextAttemptAt = new Date();
    em.persist(entity);
  }

  async findPending(limit: number): Promise<OutboxMessageEntity[]> {
    const now = new Date();
    return this.em.getRepository(OutboxMessageEntity).find(
      {
        $or: [
          { publishedAt: null, nextAttemptAt: { $lte: now } },
        ],
      },
      { orderBy: { occurredAt: 'ASC' }, limit }
    );
  }

  async markPublished(id: string): Promise<void> {
    const entity = await this.em.getRepository(OutboxMessageEntity).findOne({ id });
    if (entity) {
      entity.publishedAt = new Date();
      await this.em.flush();
    }
  }

  async markFailed(id: string): Promise<void> {
    const entity = await this.em.getRepository(OutboxMessageEntity).findOne({ id });
    if (entity) {
      entity.attempts += 1;
      entity.nextAttemptAt = new Date(Date.now() + Math.min(2 ** entity.attempts * 1000, 300000));
      await this.em.flush();
    }
  }
}
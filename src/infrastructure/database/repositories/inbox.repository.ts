import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InboxMessageEntity } from '../entities/inbox-message.entity';

export class InboxRepositoryImpl {
  private readonly repo: EntityRepository<InboxMessageEntity>;

  constructor(private readonly em: EntityManager) {
    this.repo = em.getRepository(InboxMessageEntity);
  }

  async findByConsumerAndMessageId(consumerName: string, messageId: string): Promise<InboxMessageEntity | null> {
    return this.repo.findOne({ consumerName, messageId });
  }

  async save(messageId: string, consumerName: string, payload: Record<string, unknown>, payloadHash: string): Promise<void> {
    const entity = new InboxMessageEntity();
    entity.id = crypto.randomUUID();
    entity.messageId = messageId;
    entity.consumerName = consumerName;
    entity.payload = payload;
    entity.payloadHash = payloadHash;
    entity.receivedAt = new Date();
    await this.em.persistAndFlush(entity);
  }

  async markProcessed(id: string, em: EntityManager): Promise<void> {
    const repo = em.getRepository(InboxMessageEntity);
    const entity = await repo.findOne({ id });
    if (entity) {
      entity.processedAt = new Date();
    }
  }
}
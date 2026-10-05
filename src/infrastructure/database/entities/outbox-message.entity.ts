import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core';

@Entity({ tableName: 'outbox_messages' })
@Index({ properties: ['publishedAt', 'nextAttemptAt'] })
@Index({ properties: ['aggregateId'] })
export class OutboxMessageEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ type: 'uuid' })
  aggregateId!: string;

  @Property({ length: 100 })
  eventType!: string;

  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  @Property({ onCreate: () => new Date() })
  occurredAt!: Date;

  @Property({ default: 0 })
  attempts!: number;

  @Property({ nullable: true })
  nextAttemptAt!: Date | null;

  @Property({ nullable: true })
  publishedAt!: Date | null;
}
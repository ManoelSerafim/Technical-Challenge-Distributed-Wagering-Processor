import { Entity, PrimaryKey, Property, Unique, Index } from '@mikro-orm/core';

@Entity({ tableName: 'inbox_messages' })
@Unique({ properties: ['consumerName', 'messageId'] })
@Index({ properties: ['processedAt'] })
export class InboxMessageEntity {
  @PrimaryKey({ type: 'uuid' })
  id!: string;

  @Property({ length: 200 })
  messageId!: string;

  @Property({ length: 100 })
  consumerName!: string;

  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  @Property({ length: 64 })
  payloadHash!: string;

  @Property({ onCreate: () => new Date() })
  receivedAt!: Date;

  @Property({ nullable: true })
  processedAt!: Date | null;
}
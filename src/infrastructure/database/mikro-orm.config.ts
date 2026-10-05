import { defineConfig } from '@mikro-orm/core';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { WalletEntity } from './entities/wallet.entity';
import { WagerTransactionEntity } from './entities/wager-transaction.entity';
import { LedgerEntryEntity } from './entities/ledger-entry.entity';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { OutboxMessageEntity } from './entities/outbox-message.entity';

export const mikroOrmConfig = defineConfig({
  driver: PostgreSqlDriver,
  dbName: process.env.DB_NAME || 'wagering',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'wagering',
  password: process.env.DB_PASSWORD || 'wagering',
  entities: [
    WalletEntity,
    WagerTransactionEntity,
    LedgerEntryEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
  migrations: {
    path: './src/infrastructure/database/migrations',
    pathTs: './src/infrastructure/database/migrations',
  },
  debug: process.env.NODE_ENV !== 'production',
  allowGlobalContext: true,
});
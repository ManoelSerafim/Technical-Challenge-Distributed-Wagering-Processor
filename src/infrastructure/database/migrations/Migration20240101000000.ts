import { Migration } from '@mikro-orm/migrations';

export class Migration20240101000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE wallets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        player_id uuid NOT NULL,
        currency varchar(3) NOT NULL,
        balance numeric(14,2) NOT NULL DEFAULT '0.00',
        version int NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0),
        CONSTRAINT wallets_currency_format CHECK (currency ~ '^[A-Z]{3}$')
      );
      CREATE UNIQUE INDEX wallets_player_id_currency_unique ON wallets (player_id, currency);
      CREATE INDEX wallets_player_id_idx ON wallets (player_id);
    `);

    this.addSql(`
      CREATE TABLE wager_transactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_id varchar(100) NOT NULL,
        external_transaction_id varchar(200) NOT NULL,
        idempotency_key varchar(400) NOT NULL,
        payload_hash varchar(64) NOT NULL,
        wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        player_id uuid NOT NULL,
        round_id varchar(100),
        game_id varchar(100),
        kind varchar(20) NOT NULL,
        amount numeric(14,2) NOT NULL,
        currency varchar(3) NOT NULL,
        reference_external_transaction_id varchar(200),
        reference_transaction_id uuid REFERENCES wager_transactions(id),
        status varchar(20) NOT NULL,
        failure_code varchar(50),
        processed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT wager_transactions_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT wager_transactions_kind_check CHECK (kind IN ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')),
        CONSTRAINT wager_transactions_status_check CHECK (status IN ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')),
        CONSTRAINT wager_transactions_amount_positive CHECK (amount > 0)
      );
      CREATE INDEX wager_transactions_provider_external_idx ON wager_transactions (provider_id, external_transaction_id);
      CREATE UNIQUE INDEX wager_transactions_idempotency_key_unique ON wager_transactions (idempotency_key);
      CREATE INDEX wager_transactions_wallet_status_idx ON wager_transactions (wallet_id, status);
      CREATE INDEX wager_transactions_reference_external_idx ON wager_transactions (reference_external_transaction_id);
    `);

    this.addSql(`
      CREATE TABLE ledger_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        transaction_id uuid NOT NULL REFERENCES wager_transactions(id) ON DELETE CASCADE,
        direction varchar(6) NOT NULL,
        amount numeric(14,2) NOT NULL,
        currency varchar(3) NOT NULL,
        balance_before numeric(14,2) NOT NULL,
        balance_after numeric(14,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ledger_entries_direction_check CHECK (direction IN ('DEBIT', 'CREDIT')),
        CONSTRAINT ledger_entries_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
        CONSTRAINT ledger_entries_amount_positive CHECK (amount > 0),
        CONSTRAINT ledger_entries_balance_before_non_negative CHECK (balance_before >= 0),
        CONSTRAINT ledger_entries_balance_after_non_negative CHECK (balance_after >= 0),
        CONSTRAINT ledger_entries_balance_consistency CHECK (
          (direction = 'DEBIT' AND balance_before - amount = balance_after) OR
          (direction = 'CREDIT' AND balance_before + amount = balance_after)
        )
      );
      CREATE INDEX ledger_entries_wallet_id_idx ON ledger_entries (wallet_id);
      CREATE INDEX ledger_entries_transaction_id_idx ON ledger_entries (transaction_id);
      CREATE INDEX ledger_entries_created_at_idx ON ledger_entries (created_at);
    `);

    this.addSql(`
      CREATE TABLE inbox_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id varchar(200) NOT NULL,
        consumer_name varchar(100) NOT NULL,
        payload jsonb NOT NULL,
        payload_hash varchar(64) NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        processed_at timestamptz
      );
      CREATE UNIQUE INDEX inbox_messages_consumer_message_unique ON inbox_messages (consumer_name, message_id);
      CREATE INDEX inbox_messages_processed_at_idx ON inbox_messages (processed_at);
    `);

    this.addSql(`
      CREATE TABLE outbox_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregate_id uuid NOT NULL,
        event_type varchar(100) NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        attempts int NOT NULL DEFAULT 0,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        published_at timestamptz
      );
      CREATE INDEX outbox_messages_pending_idx ON outbox_messages (published_at, next_attempt_at) WHERE published_at IS NULL;
      CREATE INDEX outbox_messages_aggregate_id_idx ON outbox_messages (aggregate_id);
    `);
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS outbox_messages;');
    this.addSql('DROP TABLE IF EXISTS inbox_messages;');
    this.addSql('DROP TABLE IF EXISTS ledger_entries;');
    this.addSql('DROP TABLE IF EXISTS wager_transactions;');
    this.addSql('DROP TABLE IF EXISTS wallets;');
  }
}
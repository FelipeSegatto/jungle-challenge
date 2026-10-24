import { Migration } from '@mikro-orm/migrations';
export class Migration202610230001 extends Migration {
    async up(): Promise<void> {
        this.addSql(`
      CREATE TABLE wallets (
        id uuid PRIMARY KEY,
        player_id uuid NOT NULL,
        currency varchar(3) NOT NULL,
        balance numeric(20,2) NOT NULL DEFAULT 0,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT wallets_player_currency_uk UNIQUE (player_id, currency),
        CONSTRAINT wallets_id_currency_uk UNIQUE (id, currency),
        CONSTRAINT wallets_amount_nonnegative CHECK (balance >= 0),
        CONSTRAINT wallets_version_positive CHECK (version >= 1),
        CONSTRAINT wallets_currency_format CHECK (currency ~ '^[A-Z]{3}$')
      );
    `);
        this.addSql(`
      CREATE TABLE wager_transactions (
        id uuid PRIMARY KEY,
        provider_id text NOT NULL,
        external_transaction_id text NOT NULL,
        idempotency_key text NOT NULL UNIQUE,
        payload_hash char(64) NOT NULL,
        wallet_id uuid NOT NULL,
        player_id uuid NOT NULL,
        round_id text NOT NULL,
        game_id text NOT NULL,
        kind text NOT NULL,
        amount numeric(20,2) NOT NULL,
        currency varchar(3) NOT NULL,
        status text NOT NULL,
        reference_external_transaction_id text,
        reference_transaction_id uuid REFERENCES wager_transactions(id),
        failure_code text,
        response_balance_amount numeric(20,2),
        processed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        reference_attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamptz,
        CONSTRAINT wagers_provider_external_uk UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT wagers_wallet_fk FOREIGN KEY (wallet_id, currency) REFERENCES wallets(id, currency),
        CONSTRAINT wagers_kind_valid CHECK (kind IN ('OPENING','BET','WIN','LOSS','REFUND','ROLLBACK')),
        CONSTRAINT wagers_status_valid CHECK (status IN ('PENDING','PENDING_REFERENCE','PROCESSED','REJECTED','FAILED')),
        CONSTRAINT wagers_amount_valid CHECK (amount >= 0 AND (kind = 'LOSS' OR amount > 0)),
        CONSTRAINT wagers_ref_required CHECK (kind NOT IN ('REFUND','ROLLBACK') OR reference_external_transaction_id IS NOT NULL),
        CONSTRAINT wagers_response_nonnegative CHECK (response_balance_amount IS NULL OR response_balance_amount >= 0)
      );
    `);
        this.addSql(`
      CREATE UNIQUE INDEX wagers_one_reversal_per_kind
      ON wager_transactions(reference_transaction_id,kind)
      WHERE kind IN ('REFUND','ROLLBACK') AND status = 'PROCESSED';
    `);
        this.addSql(`CREATE INDEX wagers_waiting_reference ON wager_transactions(next_attempt_at, id) WHERE status='PENDING_REFERENCE';`);
        this.addSql(`
      CREATE TABLE wallet_ledger_entries (
        id uuid PRIMARY KEY,
        wallet_id uuid NOT NULL,
        transaction_id uuid NOT NULL REFERENCES wager_transactions(id),
        direction text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
        amount numeric(20,2) NOT NULL CHECK (amount > 0),
        currency varchar(3) NOT NULL,
        balance_before numeric(20,2) NOT NULL CHECK(balance_before >= 0),
        balance_after numeric(20,2) NOT NULL CHECK(balance_after >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ledger_wallet_fk FOREIGN KEY (wallet_id, currency) REFERENCES wallets(id, currency),
        CONSTRAINT ledger_unique_wager UNIQUE (wallet_id, transaction_id),
        CONSTRAINT ledger_math CHECK(
          (direction='CREDIT' AND balance_after=balance_before+amount)
          OR (direction='DEBIT' AND balance_after=balance_before-amount)
        )
      );
    `);
        this.addSql(`CREATE INDEX ledger_cursor_idx ON wallet_ledger_entries(wallet_id, created_at DESC, id DESC);`);
        this.addSql(`
      CREATE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'LEDGER_IMMUTABLE'; END; $$;
    `);
        this.addSql(`
      CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON wallet_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
    `);
        this.addSql(`
      CREATE FUNCTION prevent_wager_terminal_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.status IN ('PROCESSED','REJECTED','FAILED') THEN
          RAISE EXCEPTION 'WAGER_TERMINAL_IMMUTABLE';
        END IF;
        RETURN NEW;
      END; $$;
    `);
        this.addSql(`
      CREATE TRIGGER wager_terminal_immutable BEFORE UPDATE OR DELETE ON wager_transactions
      FOR EACH ROW EXECUTE FUNCTION prevent_wager_terminal_change();
    `);
        this.addSql(`
      CREATE TABLE outbox_messages (
        id uuid PRIMARY KEY, aggregate_id uuid NOT NULL,
        event_type text NOT NULL, payload jsonb NOT NULL,
        attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
        next_attempt_at timestamptz,
        published_at timestamptz,
        occurred_at timestamptz NOT NULL DEFAULT now()
      );
    `);
        this.addSql(`CREATE INDEX outbox_due_idx ON outbox_messages(next_attempt_at,occurred_at,id) WHERE published_at IS NULL;`);
        this.addSql(`
      CREATE TABLE inbox_messages (
        id uuid PRIMARY KEY, consumer_name text NOT NULL,
        message_id text NOT NULL, payload_hash char(64) NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
        CONSTRAINT inbox_dedupe UNIQUE (consumer_name, message_id)
      );
    `);
    }
    async down(): Promise<void> {
        this.addSql('DROP TABLE IF EXISTS inbox_messages;');
        this.addSql('DROP TABLE IF EXISTS outbox_messages;');
        this.addSql('DROP TABLE IF EXISTS wallet_ledger_entries;');
        this.addSql('DROP FUNCTION IF EXISTS prevent_ledger_mutation();');
        this.addSql('DROP TABLE IF EXISTS wager_transactions;');
        this.addSql('DROP FUNCTION IF EXISTS prevent_wager_terminal_change();');
        this.addSql('DROP TABLE IF EXISTS wallets;');
    }
}

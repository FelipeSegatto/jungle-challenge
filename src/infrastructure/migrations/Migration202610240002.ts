import { Migration } from '@mikro-orm/migrations';
/** Hardens cross-table ownership and currency consistency without rewriting v1 history. */
export class Migration202610240002 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE wallets ADD CONSTRAINT wallet_id_player_currency_uk UNIQUE (id, player_id, currency);`,
    );
    this.addSql(`ALTER TABLE wager_transactions ADD CONSTRAINT wager_owner_currency_fk
      FOREIGN KEY (wallet_id, player_id, currency) REFERENCES wallets(id, player_id, currency);`);
    this.addSql(`ALTER TABLE wager_transactions ADD CONSTRAINT wager_tx_wallet_currency_uk
      UNIQUE (id, wallet_id, currency);`);
    this.addSql(`ALTER TABLE wallet_ledger_entries ADD CONSTRAINT ledger_transaction_scope_fk
      FOREIGN KEY (transaction_id, wallet_id, currency)
      REFERENCES wager_transactions(id, wallet_id, currency);`);
    this.addSql(`ALTER TABLE wager_transactions ADD CONSTRAINT opening_is_internal
      CHECK (kind <> 'OPENING' OR (provider_id = '__internal__' AND status = 'PROCESSED'));`);
    this.addSql(`CREATE INDEX inbox_processed_idx ON inbox_messages(processed_at, message_id);`);
  }
  async down(): Promise<void> {
    this.addSql('DROP INDEX IF EXISTS inbox_processed_idx;');
    this.addSql('ALTER TABLE wager_transactions DROP CONSTRAINT opening_is_internal;');
    this.addSql('ALTER TABLE wallet_ledger_entries DROP CONSTRAINT ledger_transaction_scope_fk;');
    this.addSql('ALTER TABLE wager_transactions DROP CONSTRAINT wager_tx_wallet_currency_uk;');
    this.addSql('ALTER TABLE wager_transactions DROP CONSTRAINT wager_owner_currency_fk;');
    this.addSql('ALTER TABLE wallets DROP CONSTRAINT wallet_id_player_currency_uk;');
  }
}

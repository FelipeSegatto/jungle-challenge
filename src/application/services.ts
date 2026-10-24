import { Injectable } from '@nestjs/common';
import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { DomainError } from '../domain/errors';
import { Wallet } from '../domain/wallet';
import { Money } from '../domain/money';
import { WalletLedgerEntry } from '../domain/ledger';
import { WagerTransaction, type Direction, type WagerKind } from '../domain/wager';
import { payloadHash } from '../domain/hash';
import { WalletBalanceChanged, WagerTransactionProcessed, WagerTransactionRejected, WagerTransactionPendingReference, IntegrationEvent } from '../domain/events';
import { WalletRow, WagerRow, LedgerRow, OutboxRow, InboxRow } from '../infrastructure/entities/rows';
import type { ProcessWagerDto } from '../presentation/dtos';
import { transactionCounter, duplicateCounter, conflictCounter, processingLatency, reconciliationMismatch, retryCounter } from '../infrastructure/metrics';
export interface InboxContext {
    consumerName: string;
    messageId: string;
    payloadHash: string;
}
export interface WagerResponse {
    transactionId: string;
    status: string;
    balance: {
        amount: string;
        currency: string;
    } | null;
    failureCode: string | null;
    idempotentReplay: boolean;
}
function dbCode(error: unknown): string | undefined {
    const e = error as {
        code?: string;
        driverException?: {
            code?: string;
        };
        cause?: {
            code?: string;
        };
    };
    return e?.driverException?.code ?? e?.cause?.code ?? e?.code;
}
async function recordOutbox(em: EntityManager, event: IntegrationEvent<unknown>): Promise<void> {
    const row = new OutboxRow();
    row.id = event.eventId;
    row.aggregateId = event.aggregateId;
    row.eventType = event.eventType;
    row.payload = event.toJSON();
    row.occurredAt = event.occurredAt;
    em.persist(row);
}
function mapWallet(row: WalletRow): Wallet {
    return Wallet.rehydrate({ id: row.id, playerId: row.playerId, currency: row.currency,
        balance: Money.from({ amount: row.balance, currency: row.currency }), version: row.version,
        createdAt: row.createdAt, updatedAt: row.updatedAt });
}
@Injectable()
export class WalletService {
    constructor(private readonly em: EntityManager) { }
    async create(playerId: string, initialBalance: {
        amount: string;
        currency: string;
    }) {
        const amount = Money.from(initialBalance);
        // Regra de recorte do MVP: operar BRL; Money permanece multimoeda.
        if (amount.currency !== 'BRL')
            throw new DomainError('UNSUPPORTED_CURRENCY', 'O MVP aceita BRL.', 400);
        try {
            return await this.em.transactional(async (em) => {
                const now = new Date();
                const wallet = Wallet.open(playerId, amount, now);
                const row = new WalletRow();
                row.id = wallet.id;
                row.playerId = wallet.playerId;
                row.currency = wallet.currency;
                row.balance = wallet.balance.toJSON().amount;
                row.version = 1;
                row.createdAt = now;
                row.updatedAt = now;
                em.persist(row);
                await em.flush(); // FK exige wallet antes de OPENING.
                if (amount.isPositive()) {
                    const transactionId = randomUUID();
                    const wager = new WagerRow();
                    wager.id = transactionId;
                    wager.providerId = '__internal__';
                    wager.externalTransactionId = `opening:${wallet.id}`;
                    wager.idempotencyKey = `opening:${wallet.id}`;
                    wager.payloadHash = payloadHash({ walletId: wallet.id, amount: amount.toJSON() });
                    wager.walletId = wallet.id;
                    wager.playerId = playerId;
                    wager.roundId = 'opening';
                    wager.gameId = 'system';
                    wager.kind = 'OPENING';
                    wager.amount = amount.toJSON().amount;
                    wager.currency = amount.currency;
                    wager.status = 'PROCESSED';
                    wager.responseBalanceAmount = amount.toJSON().amount;
                    wager.createdAt = now;
                    wager.processedAt = now;
                    em.persist(wager);
                    await em.flush();
                    const ledger = WalletLedgerEntry.create({ walletId: wallet.id, transactionId, direction: 'CREDIT', money: amount,
                        balanceBefore: Money.zero(amount.currency), balanceAfter: amount, createdAt: now });
                    const entry = new LedgerRow();
                    entry.id = ledger.id;
                    entry.walletId = wallet.id;
                    entry.transactionId = transactionId;
                    entry.direction = 'CREDIT';
                    entry.amount = amount.toJSON().amount;
                    entry.currency = amount.currency;
                    entry.balanceBefore = '0.00';
                    entry.balanceAfter = amount.toJSON().amount;
                    entry.createdAt = now;
                    em.persist(entry);
                    await recordOutbox(em, WagerTransactionProcessed.from(wallet.id, transactionId, 'OPENING', now));
                    await recordOutbox(em, WalletBalanceChanged.from({ walletId: wallet.id, transactionId,
                        direction: 'CREDIT', money: amount.toJSON(), balanceBefore: Money.zero(amount.currency).toJSON(),
                        balanceAfter: amount.toJSON(), walletVersion: 1, occurredAt: now }));
                }
                return { id: wallet.id, playerId: wallet.playerId, balance: wallet.balance.toJSON(), version: wallet.version };
            });
        }
        catch (e) {
            if (dbCode(e) === '23505')
                throw new DomainError('WALLET_ALREADY_EXISTS', 'Wallet para player/moeda já existe.', 409);
            throw e;
        }
    }
}
@Injectable()
export class WagerService {
    constructor(private readonly em: EntityManager) { }
    async process(command: ProcessWagerDto, key: string, inbox?: InboxContext): Promise<WagerResponse> {
        if (typeof key !== 'string' || !key.trim() || key.length > 255)
            throw new DomainError('MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key obrigatório (máx. 255).', 400);
        const money = Money.from(command.money);
        if (money.currency !== 'BRL')
            throw new DomainError('UNSUPPORTED_CURRENCY', 'MVP aceita somente BRL.', 400);
        if (!money.isPositive() && command.kind !== 'LOSS')
            throw new DomainError('INVALID_AMOUNT', 'A operação deve possuir quantia maior que zero.', 400);
        if ((command.kind === 'REFUND' || command.kind === 'ROLLBACK') && !command.referenceExternalTransactionId)
            throw new DomainError('REFERENCE_REQUIRED', 'Referência obrigatória.', 400);
        if (['BET', 'LOSS'].includes(command.kind) && command.referenceExternalTransactionId)
            throw new DomainError('REFERENCE_NOT_ALLOWED', 'BET/LOSS não aceitam referência neste modelo.', 400);
        if (command.referenceExternalTransactionId === command.externalTransactionId)
            throw new DomainError('SELF_REFERENCE', 'Uma operação não pode referenciar a si própria.', 400);
        // Hash inclui SOMENTE dados de negócio; exclui chave e metadados de transporte.
        const hash = payloadHash({ providerId: command.providerId, externalTransactionId: command.externalTransactionId,
            walletId: command.walletId, playerId: command.playerId, roundId: command.roundId,
            gameId: command.gameId, kind: command.kind, money: money.toJSON(),
            referenceExternalTransactionId: command.referenceExternalTransactionId ?? null });
        const header = key.trim();
        const started = Date.now();
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const result = await this.em.transactional(async (em) => {
                    // Lock POR WALLET: sincroniza 3+ instâncias sem mutex global.
                    const walletRow = await em.findOne(WalletRow, { id: command.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
                    if (!walletRow)
                        throw new DomainError('WALLET_NOT_FOUND', 'Wallet inexistente.', 404);
                    if (walletRow.playerId !== command.playerId)
                        throw new DomainError('PLAYER_WALLET_MISMATCH', 'Wallet não pertence ao player.', 422);
                    if (walletRow.currency !== money.currency)
                        throw new DomainError('CURRENCY_MISMATCH', 'Moeda da wallet divergente.', 422);
                    // A inbox entra no MESMO commit do saldo, ledger e outbox.
                    // O lock por wallet serializa redeliveries concorrentes desta operação.
                    if (inbox) {
                        const duplicate = await em.findOne(InboxRow, {
                            consumerName: inbox.consumerName, messageId: inbox.messageId,
                        });
                        if (duplicate) {
                            if (duplicate.payloadHash !== inbox.payloadHash) {
                                throw new DomainError('INBOX_PAYLOAD_CONFLICT', 'MessageId reutilizado com outro conteúdo.', 409);
                            }
                            const saved = await em.findOne(WagerRow, { idempotencyKey: header });
                            if (!saved)
                                throw new Error('INBOX_WITHOUT_WAGER');
                            if (saved.payloadHash !== hash) {
                                throw new DomainError('IDEMPOTENCY_CONFLICT', 'Chave usada com outro payload.', 409);
                            }
                            return this.response(saved, true);
                        }
                        const received = new InboxRow();
                        received.id = randomUUID();
                        received.consumerName = inbox.consumerName;
                        received.messageId = inbox.messageId;
                        received.payloadHash = inbox.payloadHash;
                        received.receivedAt = new Date();
                        received.processedAt = received.receivedAt;
                        em.persist(received);
                    }
                    const existing = await em.findOne(WagerRow, { idempotencyKey: header });
                    if (existing) {
                        if (existing.payloadHash !== hash)
                            throw new DomainError('IDEMPOTENCY_CONFLICT', 'Chave já usada com outro payload.', 409);
                        return this.response(existing, true);
                    }
                    const sameExternal = await em.findOne(WagerRow, { providerId: command.providerId, externalTransactionId: command.externalTransactionId });
                    if (sameExternal)
                        throw new DomainError('EXTERNAL_ID_CONFLICT', 'ID externo já registrado com outra chave.', 409);
                    const wallet = mapWallet(walletRow);
                    const now = new Date();
                    const wager = WagerTransaction.create({ providerId: command.providerId, externalTransactionId: command.externalTransactionId,
                        idempotencyKey: header, payloadHash: hash, walletId: command.walletId, playerId: command.playerId,
                        roundId: command.roundId, gameId: command.gameId, kind: command.kind, money,
                        referenceExternalTransactionId: command.referenceExternalTransactionId ?? null }, now);
                    let reference: WagerRow | null = null;
                    let failureCode: string | null = null;
                    let direction: Direction | null = null;
                    let pending = false;
                    if (command.referenceExternalTransactionId) {
                        reference = await em.findOne(WagerRow, { providerId: command.providerId,
                            externalTransactionId: command.referenceExternalTransactionId });
                        if (!reference || reference.status === 'PENDING' || reference.status === 'PENDING_REFERENCE') {
                            pending = true;
                        }
                        else if (reference.status !== 'PROCESSED') {
                            failureCode = 'REFERENCE_NOT_PROCESSED';
                        }
                        else if (reference.walletId !== command.walletId || reference.playerId !== command.playerId ||
                            reference.currency !== money.currency || reference.roundId !== command.roundId ||
                            reference.providerId !== command.providerId) {
                            failureCode = 'REFERENCE_SCOPE_MISMATCH';
                        }
                        else if (reference.amount !== money.toJSON().amount &&
                            (command.kind === 'REFUND' || command.kind === 'ROLLBACK')) {
                            failureCode = 'REFERENCE_AMOUNT_MISMATCH';
                        }
                        else if ((command.kind === 'REFUND' && reference.kind !== 'BET') ||
                            (command.kind === 'ROLLBACK' && !['BET', 'WIN', 'REFUND'].includes(reference.kind)) ||
                            (command.kind === 'WIN' && reference.kind !== 'BET')) {
                            failureCode = 'INVALID_REFERENCE_KIND';
                        }
                        else if (command.kind === 'REFUND' || command.kind === 'ROLLBACK') {
                            const previous = await em.findOne(WagerRow, {
                                referenceTransactionId: reference.id, kind: command.kind, status: 'PROCESSED',
                            });
                            if (previous)
                                failureCode = 'ALREADY_REVERSED';
                        }
                    }
                    if (!failureCode && !pending)
                        direction = wager.ledgerDirectionFor(reference?.kind as WagerKind | undefined);
                    let before = wallet.balance;
                    let after = wallet.balance;
                    if (pending)
                        wager.markPendingReference();
                    else if (failureCode)
                        wager.reject(failureCode);
                    else if (direction) {
                        try {
                            ({ before, after } = direction === 'CREDIT' ? wallet.credit(money, now) : wallet.debit(money, now));
                            wager.markProcessed(reference?.id ?? null, now);
                        }
                        catch (e) {
                            if (e instanceof DomainError && e.code === 'INSUFFICIENT_BALANCE') {
                                wager.reject(command.kind === 'ROLLBACK' ? 'REVERSAL_INSUFFICIENT_BALANCE' : 'INSUFFICIENT_BALANCE');
                            }
                            else
                                throw e;
                        }
                    }
                    else
                        wager.markProcessed(reference?.id ?? null, now);
                    const row = new WagerRow();
                    row.id = wager.id;
                    row.providerId = command.providerId;
                    row.externalTransactionId = command.externalTransactionId;
                    row.idempotencyKey = header;
                    row.payloadHash = hash;
                    row.walletId = wallet.id;
                    row.playerId = command.playerId;
                    row.roundId = command.roundId;
                    row.gameId = command.gameId;
                    row.kind = command.kind;
                    row.amount = money.toJSON().amount;
                    row.currency = money.currency;
                    row.status = wager.status;
                    row.referenceExternalTransactionId = command.referenceExternalTransactionId ?? null;
                    row.referenceTransactionId = wager.referenceTransactionId;
                    row.failureCode = wager.failureCode;
                    row.responseBalanceAmount = wallet.balance.toJSON().amount;
                    row.createdAt = now;
                    row.processedAt = wager.processedAt;
                    if (wager.status === 'PENDING_REFERENCE')
                        row.nextAttemptAt = new Date(now.getTime() + 1000);
                    em.persist(row);
                    await em.flush(); // FK do ledger depende da transação financeira.
                    if (wager.status === 'PROCESSED' && direction) {
                        walletRow.balance = wallet.balance.toJSON().amount;
                        walletRow.version = wallet.version;
                        walletRow.updatedAt = wallet.updatedAt;
                        const entry = WalletLedgerEntry.create({ walletId: wallet.id, transactionId: wager.id, direction,
                            money, balanceBefore: before, balanceAfter: after, createdAt: now });
                        const ledger = new LedgerRow();
                        ledger.id = entry.id;
                        ledger.walletId = wallet.id;
                        ledger.transactionId = wager.id;
                        ledger.direction = direction;
                        ledger.amount = money.toJSON().amount;
                        ledger.currency = money.currency;
                        ledger.balanceBefore = before.toJSON().amount;
                        ledger.balanceAfter = after.toJSON().amount;
                        ledger.createdAt = now;
                        em.persist(ledger);
                        await recordOutbox(em, WalletBalanceChanged.from({ walletId: wallet.id, transactionId: wager.id,
                            direction, money: money.toJSON(), balanceBefore: before.toJSON(), balanceAfter: after.toJSON(),
                            walletVersion: wallet.version, occurredAt: now }));
                    }
                    if (wager.status === 'PROCESSED')
                        await recordOutbox(em, WagerTransactionProcessed.from(wallet.id, wager.id, command.kind, now));
                    if (wager.status === 'REJECTED')
                        await recordOutbox(em, WagerTransactionRejected.from(wallet.id, wager.id, wager.failureCode!, now));
                    if (wager.status === 'PENDING_REFERENCE')
                        await recordOutbox(em, WagerTransactionPendingReference.from(wallet.id, wager.id, command.referenceExternalTransactionId!, now));
                    await em.flush();
                    return this.response(row, false);
                });
                if (result.idempotentReplay)
                    duplicateCounter.inc();
                else
                    transactionCounter.labels(result.status).inc();
                processingLatency.observe((Date.now() - started) / 1000);
                return result;
            }
            catch (error) {
                const code = dbCode(error);
                if (code === '23505') {
                    // Após rollback, abrir contexto LIMPO para recuperar a resposta do vencedor.
                    const original = await this.em.fork().findOne(WagerRow, { idempotencyKey: header });
                    if (original) {
                        if (original.payloadHash !== hash)
                            throw new DomainError('IDEMPOTENCY_CONFLICT', 'Chave usada com payload diferente.', 409);
                        duplicateCounter.inc();
                        processingLatency.observe((Date.now() - started) / 1000);
                        return this.response(original, true);
                    }
                    const external = await this.em.fork().findOne(WagerRow, { providerId: command.providerId, externalTransactionId: command.externalTransactionId });
                    if (external)
                        throw new DomainError('EXTERNAL_ID_CONFLICT', 'Identificador externo duplicado.', 409);
                    if (inbox) {
                        const collision = await this.em.fork().findOne(InboxRow, { consumerName: inbox.consumerName, messageId: inbox.messageId });
                        if (collision)
                            throw new DomainError('INBOX_MESSAGE_CONFLICT', 'Mensagem já consumida com outra operação.', 409);
                    }
                }
                if (code === '40P01' || code === '40001') {
                    conflictCounter.inc();
                    if (attempt < 2)
                        continue;
                }
                throw error;
            }
        }
        throw new DomainError('RETRY_LIMIT', 'Conflito transacional excedeu limite.', 503);
    }
    /** Reprocessa uma transação previamente aceita; nunca cria uma segunda idempotency key. */
    async retryPendingReference(transactionId: string, maxAttempts = 10): Promise<'waiting' | 'processed' | 'rejected' | 'skipped'> {
        const lookup = await this.em.fork().findOne(WagerRow, { id: transactionId });
        if (!lookup || lookup.status !== 'PENDING_REFERENCE')
            return 'skipped';
        return this.em.fork().transactional(async (em) => {
            const walletRow = await em.findOne(WalletRow, { id: lookup.walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
            if (!walletRow)
                throw new Error('PENDING_WALLET_MISSING');
            const row = await em.findOne(WagerRow, { id: transactionId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
            if (!row || row.status !== 'PENDING_REFERENCE')
                return 'skipped';
            const now = new Date();
            if (row.nextAttemptAt && row.nextAttemptAt > now)
                return 'skipped';
            const reference = row.referenceExternalTransactionId
                ? await em.findOne(WagerRow, { providerId: row.providerId, externalTransactionId: row.referenceExternalTransactionId })
                : null;
            if (!reference || ['PENDING', 'PENDING_REFERENCE'].includes(reference.status)) {
                row.referenceAttempts += 1;
                if (row.referenceAttempts >= maxAttempts) {
                    row.status = 'REJECTED';
                    row.failureCode = 'REFERENCE_NOT_FOUND';
                    row.nextAttemptAt = null;
                    row.responseBalanceAmount = walletRow.balance;
                    await recordOutbox(em, WagerTransactionRejected.from(row.walletId, row.id, row.failureCode, now));
                    return 'rejected';
                }
                const backoff = Math.min(60000, 1000 * 2 ** Math.min(row.referenceAttempts, 6));
                row.nextAttemptAt = new Date(now.getTime() + backoff);
                retryCounter.labels('reference').inc();
                return 'waiting';
            }
            const money = Money.from({ amount: row.amount, currency: row.currency });
            const wallet = mapWallet(walletRow);
            let failure: string | null = null;
            if (reference.status !== 'PROCESSED')
                failure = 'REFERENCE_NOT_PROCESSED';
            else if (reference.walletId !== row.walletId || reference.playerId !== row.playerId ||
                reference.providerId !== row.providerId || reference.roundId !== row.roundId ||
                reference.currency !== row.currency)
                failure = 'REFERENCE_SCOPE_MISMATCH';
            else if (reference.amount !== row.amount && (row.kind === 'REFUND' || row.kind === 'ROLLBACK'))
                failure = 'REFERENCE_AMOUNT_MISMATCH';
            else if (row.kind === 'REFUND' && reference.kind !== 'BET')
                failure = 'INVALID_REFERENCE_KIND';
            else if (row.kind === 'ROLLBACK' && !['BET', 'WIN', 'REFUND'].includes(reference.kind))
                failure = 'INVALID_REFERENCE_KIND';
            else if (row.kind === 'WIN' && reference.kind !== 'BET')
                failure = 'INVALID_REFERENCE_KIND';
            if (!failure && (row.kind === 'REFUND' || row.kind === 'ROLLBACK')) {
                const previously = await em.findOne(WagerRow, {
                    referenceTransactionId: reference.id, kind: row.kind, status: 'PROCESSED',
                });
                if (previously)
                    failure = 'ALREADY_REVERSED';
            }
            let direction: Direction | null = null;
            let before = wallet.balance;
            let after = wallet.balance;
            if (!failure) {
                const wager = WagerTransaction.rehydrate({
                    id: row.id, providerId: row.providerId, externalTransactionId: row.externalTransactionId,
                    idempotencyKey: row.idempotencyKey, payloadHash: row.payloadHash, walletId: row.walletId,
                    playerId: row.playerId, roundId: row.roundId, gameId: row.gameId,
                    kind: row.kind as WagerKind, money, referenceExternalTransactionId: row.referenceExternalTransactionId,
                    status: 'PENDING_REFERENCE', createdAt: row.createdAt,
                });
                direction = wager.ledgerDirectionFor(reference.kind as WagerKind);
                if (direction) {
                    try {
                        ({ before, after } = direction === 'CREDIT' ? wallet.credit(money, now) : wallet.debit(money, now));
                    }
                    catch (error) {
                        if (error instanceof DomainError && error.code === 'INSUFFICIENT_BALANCE') {
                            failure = row.kind === 'ROLLBACK' ? 'REVERSAL_INSUFFICIENT_BALANCE' : 'INSUFFICIENT_BALANCE';
                        }
                        else
                            throw error;
                    }
                }
            }
            row.nextAttemptAt = null;
            row.referenceTransactionId = reference.id;
            row.responseBalanceAmount = failure ? walletRow.balance : wallet.balance.toJSON().amount;
            if (failure) {
                row.status = 'REJECTED';
                row.failureCode = failure;
                await recordOutbox(em, WagerTransactionRejected.from(row.walletId, row.id, failure, now));
                return 'rejected';
            }
            row.status = 'PROCESSED';
            row.processedAt = now;
            if (direction) {
                walletRow.balance = wallet.balance.toJSON().amount;
                walletRow.version = wallet.version;
                walletRow.updatedAt = wallet.updatedAt;
                const entry = WalletLedgerEntry.create({ walletId: row.walletId, transactionId: row.id,
                    direction, money, balanceBefore: before, balanceAfter: after, createdAt: now });
                const ledger = new LedgerRow();
                ledger.id = entry.id;
                ledger.walletId = row.walletId;
                ledger.transactionId = row.id;
                ledger.direction = direction;
                ledger.amount = row.amount;
                ledger.currency = row.currency;
                ledger.balanceBefore = before.toJSON().amount;
                ledger.balanceAfter = after.toJSON().amount;
                ledger.createdAt = now;
                em.persist(ledger);
                await recordOutbox(em, WalletBalanceChanged.from({ walletId: row.walletId, transactionId: row.id,
                    direction, money: money.toJSON(), balanceBefore: before.toJSON(), balanceAfter: after.toJSON(),
                    walletVersion: wallet.version, occurredAt: now }));
            }
            await recordOutbox(em, WagerTransactionProcessed.from(row.walletId, row.id, row.kind, now));
            return 'processed';
        });
    }
    private response(row: WagerRow, replay: boolean): WagerResponse {
        return { transactionId: row.id, status: row.status,
            balance: row.responseBalanceAmount === null ? null : { amount: row.responseBalanceAmount, currency: row.currency },
            failureCode: row.failureCode, idempotentReplay: replay };
    }
}
@Injectable()
export class QueryService {
    constructor(private readonly em: EntityManager) { }
    async wallet(id: string) {
        const row = await this.em.findOne(WalletRow, { id });
        if (!row)
            throw new DomainError('WALLET_NOT_FOUND', 'Carteira não encontrada.', 404);
        return { id: row.id, playerId: row.playerId, balance: { amount: row.balance, currency: row.currency }, version: row.version };
    }
    async transaction(id: string) {
        const row = await this.em.findOne(WagerRow, { id });
        if (!row)
            throw new DomainError('TRANSACTION_NOT_FOUND', 'Transação não encontrada.', 404);
        return this.transactionDto(row);
    }
    async providerTransaction(providerId: string, externalId: string) {
        const row = await this.em.findOne(WagerRow, { providerId, externalTransactionId: externalId });
        if (!row)
            throw new DomainError('TRANSACTION_NOT_FOUND', 'Transação não encontrada.', 404);
        return this.transactionDto(row);
    }
    private transactionDto(row: WagerRow) {
        return { transactionId: row.id, providerId: row.providerId, externalTransactionId: row.externalTransactionId,
            walletId: row.walletId, kind: row.kind, status: row.status, failureCode: row.failureCode,
            referenceExternalTransactionId: row.referenceExternalTransactionId,
            balance: row.responseBalanceAmount === null ? null : { amount: row.responseBalanceAmount, currency: row.currency } };
    }
    async ledger(walletId: string, cursor: string | undefined, limit: number) {
        if (limit < 1 || limit > 100 || !Number.isInteger(limit))
            throw new DomainError('INVALID_LIMIT', 'Limit deve estar entre 1 e 100.', 400);
        const wallet = await this.em.findOne(WalletRow, { id: walletId });
        if (!wallet)
            throw new DomainError('WALLET_NOT_FOUND', 'Wallet não encontrada.', 404);
        let cursorDate: string | null = null, cursorId: string | null = null;
        if (cursor) {
            try {
                const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
                    createdAt: string;
                    id: string;
                };
                if (!/^\d{4}-\d\d-\d\dT/.test(decoded.createdAt) || !/^[\da-f-]{36}$/.test(decoded.id))
                    throw new Error('bad');
                cursorDate = decoded.createdAt;
                cursorId = decoded.id;
            }
            catch {
                throw new DomainError('INVALID_CURSOR', 'Cursor inválido.', 400);
            }
        }
        const rows = await this.em.getConnection().execute<Array<{
            id: string;
            direction: string;
            amount: string;
            currency: string;
            balance_before: string;
            balance_after: string;
            created_at: Date;
        }>>(`
      SELECT id,direction,amount,currency,balance_before,balance_after,created_at
      FROM wallet_ledger_entries WHERE wallet_id = ?
      AND (?::timestamptz IS NULL OR (created_at,id) < (?::timestamptz,?::uuid))
      ORDER BY created_at DESC,id DESC LIMIT ?
    `, [walletId, cursorDate, cursorDate, cursorId, limit + 1]);
        const page = rows.slice(0, limit), hasMore = rows.length > limit;
        const last = page.at(-1);
        return { items: page.map(r => ({ id: r.id, direction: r.direction, money: { amount: r.amount, currency: r.currency },
                balanceBefore: { amount: r.balance_before, currency: r.currency }, balanceAfter: { amount: r.balance_after, currency: r.currency },
                createdAt: r.created_at })), nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ createdAt: new Date(last.created_at).toISOString(), id: last.id })).toString('base64url') : null };
    }
    async reconcile(walletId: string) {
        return this.em.transactional(async (em) => {
            const wallet = await em.findOne(WalletRow, { id: walletId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
            if (!wallet)
                throw new DomainError('WALLET_NOT_FOUND', 'Wallet não encontrada.', 404);
            const [row] = await em.getConnection().execute<Array<{
                balance: string;
                entries: string;
            }>>(`
        SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) AS balance,
               COUNT(*)::text AS entries FROM wallet_ledger_entries WHERE wallet_id=?
      `, [walletId]);
            const calculated = new Decimal(row.balance).toFixed(2);
            const difference = new Decimal(wallet.balance).minus(calculated).toFixed(2);
            if (!new Decimal(difference).isZero()) {
                reconciliationMismatch.inc();
                console.error(JSON.stringify({ level: 'error', event: 'reconciliation_mismatch', walletId, difference }));
            }
            return { walletId, storedBalance: { amount: wallet.balance, currency: wallet.currency },
                calculatedBalance: { amount: calculated, currency: wallet.currency },
                difference: { amount: difference, currency: wallet.currency },
                consistent: new Decimal(difference).isZero(), checkedEntries: Number(row.entries) };
        });
    }
}

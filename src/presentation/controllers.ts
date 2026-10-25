import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { EntityManager } from '@mikro-orm/postgresql';
import { CreateWalletDto, ProcessWagerDto } from './dtos';
import { WalletService, WagerService, QueryService } from '../application/services';
import { NoopAuthGuard } from './noop-auth.guard';
import { SqsHealth } from '../infrastructure/sqs/health';
import { registry, outboxLag } from '../infrastructure/metrics';

@UseGuards(NoopAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly wallets: WalletService,
    private readonly queries: QueryService,
  ) {}

  @Post()
  create(@Body() command: CreateWalletDto) {
    return this.wallets.create(command.playerId, command.initialBalance);
  }

  @Get(':walletId')
  get(@Param('walletId', ParseUUIDPipe) id: string) {
    return this.queries.wallet(id);
  }

  @Get(':walletId/ledger')
  ledger(
    @Param('walletId', ParseUUIDPipe) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '50',
  ) {
    return this.queries.ledger(id, cursor, Number(limit));
  }

  @Post(':walletId/reconciliation')
  @HttpCode(200)
  reconcile(@Param('walletId', ParseUUIDPipe) id: string) {
    return this.queries.reconcile(id);
  }
}

@UseGuards(NoopAuthGuard)
@Controller('wagering/transactions')
export class WageringController {
  constructor(
    private readonly wagers: WagerService,
    private readonly queries: QueryService,
  ) {}

  @Post()
  @HttpCode(200)
  async process(
    @Headers('idempotency-key') key: string | undefined,
    @Body() command: ProcessWagerDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.wagers.process(command, key ?? '');
    response.status(
      result.status === 'PENDING_REFERENCE' ? 202 : result.status === 'REJECTED' ? 422 : 200,
    );
    return result;
  }

  @Get(':transactionId')
  get(@Param('transactionId', ParseUUIDPipe) id: string) {
    return this.queries.transaction(id);
  }
}

@UseGuards(NoopAuthGuard)
@Controller('providers/:providerId/wagering/transactions')
export class ProviderTransactionsController {
  constructor(private readonly queries: QueryService) {}

  @Get(':externalTransactionId')
  get(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return this.queries.providerTransaction(providerId, externalTransactionId);
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly em: EntityManager,
    private readonly sqs: SqsHealth,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.em.getConnection().execute('SELECT 1');
      await this.sqs.check();
      return { status: 'ok', dependencies: { postgres: 'ok', sqs: 'ok' } };
    } catch {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        status: 'not_ready',
      });
    }
  }

  @Get('metrics')
  async metrics(@Res({ passthrough: true }) response: Response) {
    const [row] = await this.em.getConnection().execute<Array<{ age: string | null }>>(`
      SELECT EXTRACT(EPOCH FROM (now() - MIN(occurred_at)))::text AS age
      FROM outbox_messages WHERE published_at IS NULL
    `);
    outboxLag.set(row?.age ? Number(row.age) : 0);
    response.type(registry.contentType);
    return registry.metrics();
  }
}

import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query,
  Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CreateWalletDto, ProcessWagerDto } from './dtos';
import { WalletService, WagerService, QueryService } from '../application/services';
import { EntityManager } from '@mikro-orm/postgresql';
import { NoopAuthGuard } from './noop-auth.guard';

@UseGuards(NoopAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletService:WalletService,private readonly queries:QueryService) {}
  @Post()
  async create(@Body() body:CreateWalletDto) { return this.walletService.create(body.playerId,body.initialBalance); }
  @Get(':walletId')
  async get(@Param('walletId',ParseUUIDPipe) id:string) { return this.queries.wallet(id); }
  @Get(':walletId/ledger')
  async ledger(@Param('walletId',ParseUUIDPipe) id:string,
    @Query('cursor') cursor?:string,@Query('limit') limit='50') {
    return this.queries.ledger(id,cursor,Number(limit));
  }
  @Post(':walletId/reconciliation')
  @HttpCode(200)
  async reconcile(@Param('walletId',ParseUUIDPipe) id:string) {return this.queries.reconcile(id);}
}

@UseGuards(NoopAuthGuard)
@Controller('wagering/transactions')
export class WageringController {
  constructor(private readonly wagers:WagerService,private readonly queries:QueryService) {}
  @Post()
  @HttpCode(200)
  async process(@Headers('idempotency-key') key:string|undefined,@Body() body:ProcessWagerDto,
    @Res({passthrough:true}) res:Response) {
    const result=await this.wagers.process(body,key??'');
    res.status(result.status==='PENDING_REFERENCE'?202:result.status==='REJECTED'?422:200);
    return result;
  }
  @Get(':transactionId')
  async get(@Param('transactionId',ParseUUIDPipe) id:string) {return this.queries.transaction(id);}
}

@UseGuards(NoopAuthGuard)
@Controller('providers/:providerId/wagering/transactions')
export class ProviderTransactionsController {
  constructor(private readonly queries:QueryService) {}
  @Get(':externalTransactionId')
  async get(@Param('providerId')provider:string,@Param('externalTransactionId')external:string) {
    return this.queries.providerTransaction(provider,external);
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly em:EntityManager) {}
  @Get('live') live() {return {status:'ok'};}
  @Get('ready') async ready(){
    // Dia 1: somente DB; no Dia 2 também checar conexão SQS.
    await this.em.getConnection().execute('SELECT 1');return {status:'ok',dependencies:{postgres:'ok'}};
  }
}

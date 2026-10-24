import { randomUUID } from 'node:crypto';
import { DomainError } from './errors';
import { Money } from './money';
export type WagerKind = 'BET' | 'WIN' | 'LOSS' | 'REFUND' | 'ROLLBACK';
export type WagerStatus = 'PENDING' | 'PENDING_REFERENCE' | 'PROCESSED' | 'REJECTED' | 'FAILED';
export type Direction = 'DEBIT' | 'CREDIT';
export const TERMINAL: ReadonlySet<WagerStatus> = new Set(['PROCESSED', 'REJECTED', 'FAILED']);

export interface WagerProperties {
  providerId: string; externalTransactionId: string; idempotencyKey: string;
  payloadHash: string; walletId: string; playerId: string; roundId: string;
  gameId: string; kind: WagerKind; money: Money;
  referenceExternalTransactionId?: string | null;
}
export interface WagerState extends WagerProperties {
  id: string; status: WagerStatus; createdAt: Date;
  failureCode?: string|null; referenceTransactionId?: string|null; processedAt?: Date|null;
}

export class WagerTransaction {
  private constructor(
    public readonly id:string,
    public readonly providerId:string,
    public readonly externalTransactionId:string,
    public readonly idempotencyKey:string,
    public readonly payloadHash:string,
    public readonly walletId:string,
    public readonly playerId:string,
    public readonly roundId:string,
    public readonly gameId:string,
    public readonly kind:WagerKind,
    public readonly money:Money,
    public readonly referenceExternalTransactionId:string|null,
    public readonly createdAt:Date,
    private _status:WagerStatus,
    private _failureCode:string|null,
    private _referenceTransactionId:string|null,
    private _processedAt:Date|null,
  ) {}

  static create(p:WagerProperties,now=new Date()):WagerTransaction {
    if ((p.kind==='REFUND'||p.kind==='ROLLBACK')&&!p.referenceExternalTransactionId)
      throw new DomainError('REFERENCE_REQUIRED','Estorno/reversão exige referência.',400);
    if(['BET','LOSS'].includes(p.kind) && p.referenceExternalTransactionId)
      throw new DomainError('REFERENCE_NOT_ALLOWED','Referência não permitida.',400);
    if (!p.money.isPositive() && p.kind!=='LOSS')
      throw new DomainError('INVALID_AMOUNT','Quantia deve ser positiva.',400);
    return new WagerTransaction(randomUUID(),p.providerId,p.externalTransactionId,p.idempotencyKey,
      p.payloadHash,p.walletId,p.playerId,p.roundId,p.gameId,p.kind,p.money,
      p.referenceExternalTransactionId??null,now,'PENDING',null,null,null);
  }
  /** Não revalida a transição; reconstrói estado válido já persistido. */
  static rehydrate(s:WagerState):WagerTransaction {
    return new WagerTransaction(s.id,s.providerId,s.externalTransactionId,s.idempotencyKey,
      s.payloadHash,s.walletId,s.playerId,s.roundId,s.gameId,s.kind,s.money,
      s.referenceExternalTransactionId??null,s.createdAt,s.status,s.failureCode??null,
      s.referenceTransactionId??null,s.processedAt??null);
  }
  get status():WagerStatus{return this._status;}
  get failureCode():string|null{return this._failureCode;}
  get referenceTransactionId():string|null{return this._referenceTransactionId;}
  get processedAt():Date|null{return this._processedAt;}
  isTerminal():boolean{return TERMINAL.has(this._status);}
  affectsBalance():boolean{return this.kind!=='LOSS';}
  requiresReference():boolean{return this.kind==='REFUND'||this.kind==='ROLLBACK';}
  matchesPayload(hash:string):boolean{return this.payloadHash===hash;}
  ledgerDirectionFor(referenceKind?: WagerKind):Direction|null {
    switch(this.kind){
      case 'BET':return 'DEBIT';
      case 'WIN':case 'REFUND':return 'CREDIT';
      case 'LOSS':return null;
      case 'ROLLBACK':
        if(!referenceKind)throw new DomainError('REFERENCE_REQUIRED','Tipo de referência ausente.',500);
        return referenceKind==='BET'?'CREDIT':'DEBIT';
    }
  }
  private assertOpen():void {
    if(this.isTerminal())throw new DomainError('INVALID_TRANSACTION_STATE','Estado terminal imutável.',500);
  }
  markPendingReference():void{this.assertOpen();this._status='PENDING_REFERENCE';}
  markProcessed(referenceId:string|null,at:Date):void{
    this.assertOpen();this._status='PROCESSED';this._referenceTransactionId=referenceId;this._processedAt=at;
  }
  reject(code:string):void{this.assertOpen();this._status='REJECTED';this._failureCode=code;}
  fail(code:string):void{this.assertOpen();this._status='FAILED';this._failureCode=code;}
}

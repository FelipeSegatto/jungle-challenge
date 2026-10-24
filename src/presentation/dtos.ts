import { IsEnum, IsNotEmpty, IsString, IsUUID, Matches, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import type { WagerKind } from '../domain/wager';

export class MoneyDto {
  @IsString() @Matches(/^(0|[1-9]\d{0,17})\.\d{2}$/) amount!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
}

export class CreateWalletDto {
  @IsUUID() playerId!: string;
  @ValidateNested() @Type(() => MoneyDto) initialBalance!: MoneyDto;
}

export class ProcessWagerDto {
  @IsString() @IsNotEmpty() providerId!: string;
  @IsString() @IsNotEmpty() externalTransactionId!: string;
  @IsUUID() playerId!: string;
  @IsUUID() walletId!: string;
  @IsString() @IsNotEmpty() roundId!: string;
  @IsString() @IsNotEmpty() gameId!: string;
  @IsEnum(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK']) kind!: WagerKind;
  @ValidateNested() @Type(() => MoneyDto) money!: MoneyDto;
  @IsOptional() @IsString() @IsNotEmpty() referenceExternalTransactionId?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional, IsIn, Length } from 'class-validator';

export class SubmitWagerTransactionDto {
  @ApiProperty({ example: 'provider-a' })
  @IsString()
  @Length(1, 100)
  providerId: string;

  @ApiProperty({ example: 'txn-123' })
  @IsString()
  @Length(1, 200)
  externalTransactionId: string;

  @ApiProperty({ example: 'wallet-uuid' })
  @IsUUID()
  walletId: string;

  @ApiProperty({ example: 'player-uuid' })
  @IsUUID()
  playerId: string;

  @ApiProperty({ example: 'round-456', required: false })
  @IsString()
  @IsOptional()
  @Length(1, 100)
  roundId?: string;

  @ApiProperty({ example: 'game-789', required: false })
  @IsString()
  @IsOptional()
  @Length(1, 100)
  gameId?: string;

  @ApiProperty({ enum: ['OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'] })
  @IsIn(['OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'])
  kind: string;

  @ApiProperty({ example: '50.00' })
  @IsString()
  amount: string;

  @ApiProperty({ example: 'BRL' })
  @IsString()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ example: 'bet-123', required: false })
  @IsString()
  @IsOptional()
  @Length(1, 200)
  referenceExternalTransactionId?: string;
}

export class WagerTransactionResponseDto {
  @ApiProperty()
  transactionId: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ required: false })
  failureCode?: string;

  @ApiProperty({ required: false })
  balanceAfter?: string;

  @ApiProperty({ required: false })
  idempotentReplay?: boolean;
}

export class ReconciliationResponseDto {
  @ApiProperty()
  walletId: string;

  @ApiProperty()
  storedBalance: string;

  @ApiProperty()
  calculatedBalance: string;

  @ApiProperty()
  difference: string;

  @ApiProperty()
  consistent: boolean;

  @ApiProperty()
  checkedEntries: number;
}
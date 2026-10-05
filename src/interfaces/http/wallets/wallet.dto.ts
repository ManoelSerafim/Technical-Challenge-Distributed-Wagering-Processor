import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional, Length } from 'class-validator';

export class CreateWalletDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  playerId: string;

  @ApiProperty({ example: 'BRL' })
  @IsString()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ example: '100.00', required: false })
  @IsString()
  @IsOptional()
  initialBalance?: string;
}

export class WalletResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  playerId: string;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  balance: string;

  @ApiProperty()
  version: number;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
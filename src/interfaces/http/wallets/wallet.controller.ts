import { Controller, Post, Get, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CreateWalletDto, WalletResponseDto } from './wallet.dto';
import { WalletService } from './wallet.service';

@ApiTags('Wallets')
@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new wallet for a player' })
  @ApiResponse({ status: 201, type: WalletResponseDto, description: 'Wallet created' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 409, description: 'Wallet already exists for player and currency' })
  async createWallet(@Body() dto: CreateWalletDto): Promise<WalletResponseDto> {
    return this.walletService.createWallet(dto.playerId, dto.currency, dto.initialBalance);
  }

  @Get(':walletId')
  @ApiOperation({ summary: 'Get wallet by ID' })
  @ApiResponse({ status: 200, type: WalletResponseDto, description: 'Wallet found' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async getWallet(@Param('walletId') walletId: string): Promise<WalletResponseDto> {
    return this.walletService.getWallet(walletId);
  }

  @Post(':walletId/reconciliation')
  @ApiOperation({ summary: 'Reconcile wallet balance with ledger' })
  @ApiResponse({ status: 200, description: 'Reconciliation result' })
  @ApiResponse({ status: 404, description: 'Wallet not found' })
  async reconcile(@Param('walletId') walletId: string) {
    return this.walletService.reconcile(walletId);
  }
}
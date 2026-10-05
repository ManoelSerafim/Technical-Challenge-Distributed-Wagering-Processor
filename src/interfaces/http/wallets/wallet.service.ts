import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Wallet, asWalletId, asPlayerId } from '@domain/wallet';
import { Money } from '@domain/money';
import { WagerUseCase } from '@application/use-cases/wager.use-case';
import { EntityManager } from '@mikro-orm/core';
import { WalletEntity } from '@infrastructure/database/entities/wallet.entity';
import { ReconciliationResult } from '@application/ports/wager.port';

interface WalletResponse {
  id: string;
  playerId: string;
  currency: string;
  balance: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly em: EntityManager,
    private readonly wagerUseCase: WagerUseCase
  ) {}

  async createWallet(playerId: string, currency: string, initialBalance?: string): Promise<WalletResponse> {
    const repo = this.em.getRepository(WalletEntity);
    
    const existing = await repo.findOne({ playerId: asPlayerId(playerId), currency: currency.toUpperCase() });
    if (existing) {
      throw new ConflictException('Wallet already exists for this player and currency');
    }

    let balance: Money;
    if (initialBalance) {
      try {
        balance = Money.from({ amount: initialBalance, currency: currency.toUpperCase() });
      } catch {
        throw new BadRequestException('Invalid initial balance format');
      }
    } else {
      balance = Money.zero(currency.toUpperCase());
    }

    const wallet = Wallet.create(asPlayerId(playerId), currency.toUpperCase(), balance);
    
    const entity = WalletEntity.fromDomain(wallet);
    await this.em.persistAndFlush(entity);

    return this.toResponse(wallet);
  }

  async getWallet(walletId: string): Promise<WalletResponse> {
    const repo = this.em.getRepository(WalletEntity);
    const entity = await repo.findOne({ id: asWalletId(walletId) });
    
    if (!entity) {
      throw new NotFoundException('Wallet not found');
    }

    return this.toResponse(entity.toDomain());
  }

  async reconcile(walletId: string): Promise<ReconciliationResult> {
    return this.wagerUseCase.reconcile(asWalletId(walletId));
  }

  private toResponse(wallet: Wallet): WalletResponse {
    return {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balance: wallet.balance.amount,
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }
}
import { Injectable, BadRequestException, ConflictException, UnprocessableEntityException, ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import { SubmitWagerTransactionDto } from './wagering.dto';
import { WagerUseCase, ProcessWagerCommand, WalletId, PlayerId } from '@application/ports/wager.port';
import { WagerTransactionKind } from '@domain/wager';
import { WagerTransactionEntity } from '@infrastructure/database/entities/wager-transaction.entity';
import { EntityManager } from '@mikro-orm/core';
import { Money } from '@domain/money';
import { WagerTransaction } from '@domain/wager';

@Injectable()
export class WageringService {
  constructor(
    private readonly wagerUseCase: WagerUseCase,
    private readonly em: EntityManager
  ) {}

  async submitTransaction(dto: SubmitWagerTransactionDto, idempotencyKey: string): Promise<WagerTransactionResponse> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const expectedKey = `${dto.providerId}:${dto.externalTransactionId}`;
    if (idempotencyKey !== expectedKey) {
      throw new BadRequestException('Idempotency-Key must match providerId:externalTransactionId');
    }

    const businessPayload = this.extractBusinessPayload(dto);
    const payloadHash = this.calculatePayloadHash(businessPayload);

    try {
      const command: ProcessWagerCommand = {
        providerId: dto.providerId,
        externalTransactionId: dto.externalTransactionId,
        idempotencyKey,
        payloadHash,
        walletId: dto.walletId as WalletId,
        playerId: dto.playerId as PlayerId,
        roundId: dto.roundId || null,
        gameId: dto.gameId || null,
        kind: dto.kind as WagerTransactionKind,
        amount: Money.from({ amount: dto.amount, currency: dto.currency }),
        referenceExternalTransactionId: dto.referenceExternalTransactionId || null,
      };

      const result = await this.wagerUseCase.processWager(command);

      return {
        transactionId: result.transactionId,
        status: result.status,
        failureCode: result.failureCode,
        balanceAfter: result.balanceAfter?.amount,
        idempotentReplay: result.idempotentReplay,
      };
    } catch (error) {
      if (error.message === 'IDEMPOTENCY_CONFLICT') {
        throw new ConflictException('Idempotency conflict: same key with different payload');
      }
      if (error.message === 'WALLET_NOT_FOUND') {
        throw new NotFoundException('Wallet not found');
      }
      if (error.message === 'CURRENCY_MISMATCH') {
        throw new UnprocessableEntityException('Currency mismatch between wallet and transaction');
      }
      if (error.message === 'INSUFFICIENT_BALANCE') {
        throw new UnprocessableEntityException('Insufficient balance');
      }
      if (error.message === 'REFERENCE_NOT_FOUND' || error.message === 'REFERENCE_NOT_TERMINAL' || 
          error.message === 'INVALID_REFERENCE_KIND' || error.message === 'AMOUNT_MISMATCH' ||
          error.message === 'DUPLICATE_REFUND' || error.message === 'DUPLICATE_ROLLBACK' ||
          error.message === 'WALLET_ALREADY_INITIALIZED' || error.message === 'ROLLBACK_WOULD_NEGATIVE_BALANCE') {
        throw new UnprocessableEntityException(error.message);
      }
      if (error.message === 'UNKNOWN_TRANSACTION_KIND') {
        throw new BadRequestException('Unknown transaction kind');
      }
      throw new ServiceUnavailableException('Transient infrastructure failure');
    }
  }

  async getTransaction(transactionId: string): Promise<WagerTransactionResponse> {
    const repo = this.em.getRepository(WagerTransactionEntity);
    const entity = await repo.findOne({ id: transactionId });
    
    if (!entity) {
      throw new NotFoundException('Transaction not found');
    }

    return this.toResponse(entity.toDomain());
  }

  async getTransactionByProvider(providerId: string, externalTransactionId: string): Promise<WagerTransactionResponse> {
    const repo = this.em.getRepository(WagerTransactionEntity);
    const entity = await repo.findOne({ providerId, externalTransactionId });
    
    if (!entity) {
      throw new NotFoundException('Transaction not found');
    }

    return this.toResponse(entity.toDomain());
  }

  private extractBusinessPayload(dto: SubmitWagerTransactionDto): Record<string, unknown> {
    return {
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      walletId: dto.walletId,
      playerId: dto.playerId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      amount: dto.amount,
      currency: dto.currency,
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
    };
  }

  private calculatePayloadHash(payload: Record<string, unknown>): string {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    let hash = 0;
    for (let i = 0; i < canonical.length; i++) {
      const char = canonical.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }

  private toResponse(transaction: WagerTransaction): WagerTransactionResponse {
    return {
      id: transaction.id,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      amount: transaction.amount,
      currency: transaction.currency,
      referenceExternalTransactionId: transaction.referenceExternalTransactionId,
      referenceTransactionId: transaction.referenceTransactionId,
      status: transaction.status,
      failureCode: transaction.failureCode,
      processedAt: transaction.processedAt,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
    };
  }
}

interface WagerTransactionResponse {
  transactionId: string;
  status: string;
  failureCode?: string;
  balanceAfter?: string;
  idempotentReplay?: boolean;
}
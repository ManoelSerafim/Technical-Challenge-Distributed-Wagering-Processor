import { Controller, Post, Get, Body, HttpCode, HttpStatus, Header, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { SubmitWagerTransactionDto, WagerTransactionResponseDto } from './wagering.dto';
import { WageringService } from './wagering.service';

@ApiTags('Wagering')
@Controller('wagering')
export class WageringController {
  constructor(private readonly wageringService: WageringService) {}

  @Post('transactions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a wager transaction' })
  @ApiHeader({ name: 'Idempotency-Key', description: 'Idempotency key (providerId:externalTransactionId)', required: true })
  @ApiResponse({ status: 200, type: WagerTransactionResponseDto, description: 'Transaction processed' })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 409, description: 'Idempotency conflict - same key, different payload' })
  @ApiResponse({ status: 422, description: 'Business rejection (e.g., insufficient balance)' })
  @ApiResponse({ status: 503, description: 'Transient infrastructure failure' })
  async submitTransaction(
    @Body() dto: SubmitWagerTransactionDto,
    @Header('Idempotency-Key') idempotencyKey: string
  ): Promise<WagerTransactionResponseDto> {
    return this.wageringService.submitTransaction(dto, idempotencyKey);
  }

  @Get('transactions/:transactionId')
  @ApiOperation({ summary: 'Get transaction by ID' })
  @ApiResponse({ status: 200, description: 'Transaction found' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  async getTransaction(@Param('transactionId') transactionId: string) {
    return this.wageringService.getTransaction(transactionId);
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  @ApiOperation({ summary: 'Get transaction by provider and external ID' })
  @ApiResponse({ status: 200, description: 'Transaction found' })
  @ApiResponse({ status: 404, description: 'Transaction not found' })
  async getTransactionByProvider(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string
  ) {
    return this.wageringService.getTransactionByProvider(providerId, externalTransactionId);
  }
}
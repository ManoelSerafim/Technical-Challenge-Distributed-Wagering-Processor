import { Module } from '@nestjs/common';
import { WalletController } from './wallets/wallet.controller';
import { WalletService } from './wallets/wallet.service';
import { WageringController } from './wagering/wagering.controller';
import { WageringService } from './wagering/wagering.service';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { APP_GUARD } from '@nestjs/core';
import { ShutdownService } from '../../common/shutdown/shutdown.service';

@Module({
  controllers: [
    WalletController,
    WageringController,
    HealthController,
  ],
  providers: [
    WalletService,
    WageringService,
    HealthService,
    ShutdownService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [
    WalletService,
    WageringService,
    HealthService,
    ShutdownService,
  ],
})
export class HttpModule {}
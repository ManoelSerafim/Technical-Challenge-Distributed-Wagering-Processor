import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe - indicates if the process is running' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  async live() {
    return this.healthService.live();
  }

  @Get('ready')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Readiness probe - checks dependencies (PostgreSQL, SQS)' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service not ready' })
  async ready() {
    return this.healthService.ready();
  }
}
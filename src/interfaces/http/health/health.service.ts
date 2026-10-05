import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';

interface HealthCheckResult {
  status: 'up' | 'down';
  latencyMs?: number;
  error?: string;
}

interface ReadyResponse {
  status: string;
  timestamp: string;
  checks: Record<string, HealthCheckResult>;
}

@Injectable()
export class HealthService {
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;

  constructor(private readonly em: EntityManager) {
    this.sqsClient = new SQSClient({
      endpoint: process.env.SQS_ENDPOINT || 'http://localhost:4566',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      },
    });
    this.queueUrl = process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/wager-transactions.fifo';
  }

  async live(): Promise<{ status: string; timestamp: string }> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<ReadyResponse> {
    const checks: Record<string, HealthCheckResult> = {};
    let allUp = true;

    // Check PostgreSQL
    try {
      const start = Date.now();
      await this.em.getConnection().execute('SELECT 1');
      checks.postgres = { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
      checks.postgres = { status: 'down', error: error.message };
      allUp = false;
    }

    // Check SQS
    try {
      const start = Date.now();
      await this.sqsClient.send(new GetQueueAttributesCommand({
        QueueUrl: this.queueUrl,
        AttributeNames: ['All'],
      }));
      checks.sqs = { status: 'up', latencyMs: Date.now() - start };
    } catch (error) {
      checks.sqs = { status: 'down', error: error.message };
      allUp = false;
    }

    return {
      status: allUp ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
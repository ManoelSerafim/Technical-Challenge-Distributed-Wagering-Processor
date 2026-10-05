#!/usr/bin/env bun

import { performance } from 'perf_hooks';

interface LoadTestConfig {
  baseUrl: string;
  concurrentRequests: number;
  totalRequests: number;
  walletId: string;
  playerId: string;
  amount: string;
  currency: string;
}

interface RequestResult {
  status: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

interface LoadTestStats {
  total: number;
  successful: number;
  failed: number;
  errorsByCode: Record<number, number>;
  latency: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    min: number;
    max: number;
  };
  throughput: number;
  durationMs: number;
}

const DEFAULT_CONFIG: LoadTestConfig = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  concurrentRequests: parseInt(process.env.CONCURRENT || '50', 10),
  totalRequests: parseInt(process.env.TOTAL_REQUESTS || '500', 10),
  walletId: process.env.WALLET_ID || '',
  playerId: process.env.PLAYER_ID || '',
  amount: process.env.AMOUNT || '10.00',
  currency: process.env.CURRENCY || 'BRL',
};

function generateIdempotencyKey(index: number): string {
  return `load-test:txn-${Date.now()}-${index}`;
}

function calculatePayloadHash(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  let hash = 0;
  for (let i = 0; i < canonical.length; i++) {
    const char = canonical.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

async function createWallet(baseUrl: string, playerId: string, currency: string, initialBalance: string): Promise<string> {
  const response = await fetch(`${baseUrl}/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, currency, initialBalance }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create wallet: ${response.status} ${error}`);
  }
  
  const wallet = await response.json();
  return wallet.id;
}

async function sendTransaction(
  baseUrl: string,
  walletId: string,
  playerId: string,
  amount: string,
  currency: string,
  index: number
): Promise<RequestResult> {
  const externalTransactionId = `load-test-${Date.now()}-${index}`;
  const idempotencyKey = `load-test:${externalTransactionId}`;
  
  const businessPayload = {
    providerId: 'load-test',
    externalTransactionId,
    walletId,
    playerId,
    roundId: 'load-round',
    gameId: 'load-game',
    kind: 'BET',
    amount,
    currency,
    referenceExternalTransactionId: null,
  };
  
  const payloadHash = calculatePayloadHash(businessPayload);
  
  const startTime = performance.now();
  
  try {
    const response = await fetch(`${baseUrl}/wagering/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        ...businessPayload,
        payloadHash,
      }),
    });
    
    const durationMs = performance.now() - startTime;
    
    return {
      status: response.status,
      durationMs,
      success: response.ok,
    };
  } catch (error) {
    const durationMs = performance.now() - startTime;
    return {
      status: 0,
      durationMs,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, index)];
}

function calculateStats(results: RequestResult[], totalDurationMs: number): LoadTestStats {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  const durations = successful.map(r => r.durationMs).sort((a, b) => a - b);
  
  const errorsByCode: Record<number, number> = {};
  for (const r of failed) {
    errorsByCode[r.status] = (errorsByCode[r.status] || 0) + 1;
  }
  
  return {
    total: results.length,
    successful: successful.length,
    failed: failed.length,
    errorsByCode,
    latency: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      avg: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      min: durations[0] || 0,
      max: durations[durations.length - 1] || 0,
    },
    throughput: (results.length / totalDurationMs) * 1000,
    durationMs: totalDurationMs,
  };
}

async function runLoadTest(config: LoadTestConfig): Promise<LoadTestStats> {
  console.log('Starting load test...');
  console.log(`Config: ${JSON.stringify(config, null, 2)}`);
  
  if (!config.walletId || !config.playerId) {
    console.log('Creating wallet...');
    config.walletId = await createWallet(config.baseUrl, config.playerId || 'load-test-player', config.currency, '10000.00');
    console.log(`Created wallet: ${config.walletId}`);
  }
  
  const results: RequestResult[] = [];
  const startTime = Date.now();
  
  const batches = Math.ceil(config.totalRequests / config.concurrentRequests);
  
  for (let batch = 0; batch < batches; batch++) {
    const batchSize = Math.min(config.concurrentRequests, config.totalRequests - batch * config.concurrentRequests);
    const promises: Promise<RequestResult>[] = [];
    
    for (let i = 0; i < batchSize; i++) {
      const index = batch * config.concurrentRequests + i;
      promises.push(sendTransaction(
        config.baseUrl,
        config.walletId,
        config.playerId,
        config.amount,
        config.currency,
        index
      ));
    }
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    
    const completed = results.length;
    const successRate = (results.filter(r => r.success).length / completed * 100).toFixed(1);
    console.log(`Progress: ${completed}/${config.totalRequests} (${successRate}% success)`);
  }
  
  const totalDurationMs = Date.now() - startTime;
  return calculateStats(results, totalDurationMs);
}

function printResults(stats: LoadTestStats): void {
  console.log('\n========== LOAD TEST RESULTS ==========');
  console.log(`Total Requests:     ${stats.total}`);
  console.log(`Successful:         ${stats.successful}`);
  console.log(`Failed:             ${stats.failed}`);
  console.log(`Duration:           ${stats.durationMs}ms`);
  console.log(`Throughput:         ${stats.throughput.toFixed(2)} req/s`);
  console.log('\nLatency (successful requests):');
  console.log(`  p50:              ${stats.latency.p50.toFixed(2)}ms`);
  console.log(`  p95:              ${stats.latency.p95.toFixed(2)}ms`);
  console.log(`  p99:              ${stats.latency.p99.toFixed(2)}ms`);
  console.log(`  avg:              ${stats.latency.avg.toFixed(2)}ms`);
  console.log(`  min:              ${stats.latency.min.toFixed(2)}ms`);
  console.log(`  max:              ${stats.latency.max.toFixed(2)}ms`);
  
  if (Object.keys(stats.errorsByCode).length > 0) {
    console.log('\nErrors by status code:');
    for (const [code, count] of Object.entries(stats.errorsByCode)) {
      console.log(`  ${code}: ${count}`);
    }
  }
  console.log('========================================\n');
}

async function main() {
  const config: LoadTestConfig = { ...DEFAULT_CONFIG };
  
  if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    console.log(`
Usage: bun run test:load [options]

Environment variables:
  BASE_URL           Base URL of the API (default: http://localhost:3000)
  CONCURRENT         Concurrent requests (default: 50)
  TOTAL_REQUESTS     Total requests to send (default: 500)
  WALLET_ID          Existing wallet ID (optional)
  PLAYER_ID          Player ID for wallet creation (optional)
  AMOUNT             Bet amount (default: 10.00)
  CURRENCY           Currency (default: BRL)

Example:
  BASE_URL=http://localhost:3000 CONCURRENT=100 TOTAL_REQUESTS=1000 bun run test:load
`);
    process.exit(0);
  }
  
  try {
    const stats = await runLoadTest(config);
    printResults(stats);
    
    if (stats.failed > 0) {
      console.log('WARNING: Some requests failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('Load test failed:', error);
    process.exit(1);
  }
}

main();
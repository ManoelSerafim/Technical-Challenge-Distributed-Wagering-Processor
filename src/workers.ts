#!/usr/bin/env bun

import { SQSInboxWorker } from './src/infrastructure/messaging/consumers/sqs-inbox.worker';
import { OutboxWorker } from './src/infrastructure/messaging/publishers/outbox.worker';
import { PendingReferenceWorker } from './src/infrastructure/messaging/consumers/pending-reference.worker';

async function main() {
  const workers = [
    new SQSInboxWorker(),
    new OutboxWorker(),
    new PendingReferenceWorker(),
  ];

  console.log('Starting all workers...');

  const promises = workers.map(w => w.start());

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, stopping workers...');
    await Promise.all(workers.map(w => w.stop()));
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, stopping workers...');
    await Promise.all(workers.map(w => w.stop()));
    process.exit(0);
  });

  await Promise.all(promises);
}

main().catch(console.error);
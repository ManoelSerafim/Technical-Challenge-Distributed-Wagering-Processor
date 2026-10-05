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

  const startPromises = workers.map(w => w.start());

  const shutdown = async () => {
    console.log('Shutting down all workers...');
    await Promise.all(workers.map(w => w.shutdown()));
  };

  process.on('SIGTERM', async () => {
    await shutdown();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    await shutdown();
    process.exit(0);
  });

  await Promise.all(startPromises);
}

main().catch(console.error);
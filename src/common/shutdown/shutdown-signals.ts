import { ShutdownService } from './shutdown.service';

export function setupShutdownSignals(shutdownService: ShutdownService): void {
  const signals = ['SIGTERM', 'SIGINT'] as const;

  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`Received ${signal}, initiating graceful shutdown...`);
      await shutdownService.shutdown(signal);
      process.exit(0);
    });
  }

  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await shutdownService.shutdown('uncaughtException');
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled rejection:', reason);
    await shutdownService.shutdown('unhandledRejection');
    process.exit(1);
  });
}
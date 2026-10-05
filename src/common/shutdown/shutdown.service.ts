import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';

export interface Shutdownable {
  shutdown(): Promise<void>;
}

@Injectable()
export class ShutdownService implements OnModuleDestroy {
  private readonly logger = new Logger(ShutdownService.name);
  private readonly components: Shutdownable[] = [];
  private shuttingDown = false;

  register(component: Shutdownable): void {
    this.components.push(component);
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  async shutdown(signal?: string): Promise<void> {
    if (this.shuttingDown) {
      this.logger.warn('Shutdown already in progress');
      return;
    }

    this.shuttingDown = true;
    const reason = signal ? `Received ${signal}` : 'Application shutdown';
    this.logger.log(`Initiating graceful shutdown: ${reason}`);

    const shutdownPromises = this.components.map(async (component, index) => {
      try {
        this.logger.log(`Shutting down component ${index + 1}/${this.components.length}`);
        await component.shutdown();
        this.logger.log(`Component ${index + 1} shutdown complete`);
      } catch (error) {
        this.logger.error(`Error shutting down component ${index + 1}`, error);
      }
    });

    await Promise.all(shutdownPromises);
    this.logger.log('Graceful shutdown complete');
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}
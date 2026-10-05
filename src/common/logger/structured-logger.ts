import { Logger as NestLogger, LogLevel } from '@nestjs/common';

export interface LogContext {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
  playerId?: string;
  operation?: string;
  durationMs?: number;
  status?: string;
  error?: string;
  [key: string]: unknown;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: LogContext;
  service: string;
}

export class StructuredLogger extends NestLogger {
  private readonly serviceName: string;

  constructor(serviceName: string) {
    super();
    this.serviceName = serviceName;
  }

  log(message: string, context?: LogContext): void {
    this.write('log', message, context);
  }

  error(message: string, trace?: string, context?: LogContext): void {
    this.write('error', message, context, trace);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  verbose(message: string, context?: LogContext): void {
    this.write('verbose', message, context);
  }

  private write(
    level: LogLevel,
    message: string,
    context?: LogContext,
    trace?: string
  ): void {
    const sanitizedContext = this.sanitizeContext(context || {});
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: sanitizedContext,
      service: this.serviceName,
    };

    if (trace) {
      (entry as Record<string, unknown>).trace = trace;
    }

    const output = JSON.stringify(entry);
    
    switch (level) {
      case 'error':
        process.stderr.write(output + '\n');
        break;
      case 'warn':
      case 'log':
        process.stdout.write(output + '\n');
        break;
      case 'debug':
      case 'verbose':
        if (process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'verbose') {
          process.stdout.write(output + '\n');
        }
        break;
    }
  }

  private sanitizeContext(context: LogContext): LogContext {
    const sanitized = { ...context };
    
    const sensitiveKeys = [
      'amount',
      'balance',
      'balanceAfter',
      'balanceBefore',
      'calculatedBalance',
      'storedBalance',
      'difference',
      'payload',
      'body',
      'authorization',
      'cookie',
      'password',
      'token',
      'secret',
      'key',
    ];

    for (const key of Object.keys(sanitized)) {
      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some(k => lowerKey.includes(k))) {
        if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
          sanitized[key] = '[REDACTED]';
        } else if (typeof sanitized[key] === 'string') {
          sanitized[key] = '[REDACTED]';
        }
      }
    }

    return sanitized;
  }

  withContext(context: LogContext): StructuredLogger {
    const child = new StructuredLogger(this.serviceName);
    const originalWrite = child.write.bind(child);
    child.write = (level, message, ctx, trace) => {
      const mergedContext = { ...context, ...ctx };
      originalWrite(level, message, mergedContext, trace);
    };
    return child;
  }

  child(additionalContext: LogContext): StructuredLogger {
    return this.withContext(additionalContext);
  }
}

export function createLogger(serviceName: string): StructuredLogger {
  return new StructuredLogger(serviceName);
}

export const logger = createLogger('wagering-processor');
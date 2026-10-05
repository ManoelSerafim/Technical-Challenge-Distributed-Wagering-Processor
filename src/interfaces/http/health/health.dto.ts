export class HealthResponseDto {
  status: 'ok' | 'error';
  timestamp: string;
  checks?: Record<string, { status: 'up' | 'down'; latencyMs?: number; error?: string }>;
}
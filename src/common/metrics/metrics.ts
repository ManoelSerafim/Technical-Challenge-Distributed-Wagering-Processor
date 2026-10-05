export interface MetricLabels {
  [key: string]: string | number;
}

export interface CounterMetric {
  name: string;
  value: number;
  labels: MetricLabels;
}

export interface HistogramMetric {
  name: string;
  value: number;
  labels: MetricLabels;
}

export interface GaugeMetric {
  name: string;
  value: number;
  labels: MetricLabels;
}

export class MetricsCollector {
  private counters: Map<string, CounterMetric> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private gauges: Map<string, GaugeMetric> = new Map();

  incrementCounter(name: string, labels: MetricLabels = {}, value: number = 1): void {
    const key = this.getKey(name, labels);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.counters.set(key, { name, value, labels });
    }
  }

  recordHistogram(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.getKey(name, labels);
    const existing = this.histograms.get(key) || [];
    existing.push(value);
    if (existing.length > 1000) {
      existing.shift();
    }
    this.histograms.set(key, existing);
  }

  setGauge(name: string, value: number, labels: MetricLabels = {}): void {
    const key = this.getKey(name, labels);
    this.gauges.set(key, { name, value, labels });
  }

  getCounters(): CounterMetric[] {
    return Array.from(this.counters.values());
  }

  getHistogramStats(name: string, labels: MetricLabels = {}): { p50: number; p95: number; p99: number; count: number; sum: number } | null {
    const key = this.getKey(name, labels);
    const values = this.histograms.get(key);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);
    
    return {
      p50: this.percentile(sorted, 50),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      count,
      sum,
    };
  }

  getGauges(): GaugeMetric[] {
    return Array.from(this.gauges.values());
  }

  private getKey(name: string, labels: MetricLabels): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p / 100) - 1;
    return sorted[Math.max(0, index)];
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}

export const metrics = new MetricsCollector();

export const METRIC_NAMES = {
  TRANSACTIONS_TOTAL: 'transactions_total',
  TRANSACTIONS_DURATION_MS: 'transactions_duration_ms',
  TRANSACTIONS_BY_STATUS: 'transactions_by_status',
  IDEMPOTENCY_CONFLICTS: 'idempotency_conflicts_total',
  RETRY_COUNT: 'retry_count',
  DLQ_MESSAGES: 'dlq_messages_total',
  LOCK_CONFLICTS: 'lock_conflicts_total',
  OUTBOX_LAG: 'outbox_lag',
  RECONCILIATION_DIVERGENCES: 'reconciliation_divergences_total',
  RECONCILIATION_DURATION_MS: 'reconciliation_duration_ms',
  PROCESSING_LATENCY_MS: 'processing_latency_ms',
} as const;
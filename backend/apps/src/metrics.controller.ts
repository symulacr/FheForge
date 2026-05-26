import { Controller, Get, Logger } from '@nestjs/common';
import {
  register,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';
import { Public } from './auth/public.decorator';

/** MC-024: NestJS /metrics endpoint using prom-client.
 *
 * Exposes default system metrics (CPU, memory, event loop lag) plus:
 *  - http_requests_total (Counter)   — total HTTP requests by method/status
 *  - http_request_duration_seconds (Histogram) — request latency buckets
 *  - user_signups_total (Counter)    — cumulative new-user signups
 *
 * Prerequisite for: Grafana dashboards (MC-060), alert rules (MC-062).
 */
@Controller()
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor() {
    collectDefaultMetrics({ register });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'status', 'path'] as const,
      registers: [register],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'status', 'path'] as const,
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [register],
    });

    this.userSignupsTotal = new Counter({
      name: 'user_signups_total',
      help: 'Total number of user signups',
      labelNames: ['source'] as const,
      registers: [register],
    });

    this.logger.log('Prometheus metrics initialized');
  }

  readonly httpRequestsTotal: Counter<string>;
  readonly httpRequestDuration: Histogram<string>;
  readonly userSignupsTotal: Counter<string>;

  /** Increment request counter and return a duration-recording callback.
   *  Call the returned function after the response is sent. */
  recordRequest(method: string, path: string): (status: number) => void {
    const end = this.httpRequestDuration.startTimer({ method, path });
    return (status: number) => {
      end({ status: String(status) });
      this.httpRequestsTotal.inc({ method, status: String(status), path });
    };
  }

  /** Increment user signup counter. */
  recordSignup(source = 'wallet'): void {
    this.userSignupsTotal.inc({ source });
  }

  @Public()
  @Get('metrics')
  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}

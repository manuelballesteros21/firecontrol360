import { Controller, Get } from '@nestjs/common';
import { Pool } from 'pg';

@Controller('health')
export class HealthController {
  private readonly pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 2000 })
    : null;

  @Get()
  async check() {
    if (!this.pool) return { status: 'degraded', service: 'firecontrol360-api', database: 'not_configured' };
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', service: 'firecontrol360-api', database: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'degraded', service: 'firecontrol360-api', database: 'unavailable' };
    }
  }
}

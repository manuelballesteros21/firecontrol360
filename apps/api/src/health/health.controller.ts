import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async check() {
    try {
      await this.db.query('SELECT 1');
      return { status: 'ok', service: 'firecontrol360-api', database: 'ok', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'degraded', service: 'firecontrol360-api', database: 'unavailable' };
    }
  }
}

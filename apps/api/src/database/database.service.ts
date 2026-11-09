import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly runtimePool: Pool;
  private readonly provisioningPool: Pool | null;

  constructor() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    this.runtimePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX ?? 15),
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      application_name: 'firecontrol360-api',
    });
    this.provisioningPool = process.env.PROVISIONING_DATABASE_URL
      ? new Pool({
          connectionString: process.env.PROVISIONING_DATABASE_URL,
          max: 3,
          connectionTimeoutMillis: 5000,
          application_name: 'firecontrol360-provisioning',
        })
      : null;
  }

  async query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    return this.runtimePool.query<T>(text, values);
  }

  async withTenant<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.runtimePool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async withProvisioning<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.provisioningPool) throw new Error('PROVISIONING_DATABASE_URL is not configured');
    const client = await this.provisioningPool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async platformQuery<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
    if (!this.provisioningPool) throw new Error('PROVISIONING_DATABASE_URL is not configured');
    return this.provisioningPool.query<T>(text, values);
  }

  async onModuleDestroy() {
    await this.runtimePool.end();
    await this.provisioningPool?.end();
  }
}

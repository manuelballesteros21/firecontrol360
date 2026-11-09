import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class TenantProvisioningService {
  constructor(private readonly db: DatabaseService) {}

  async provision(input: {
    legal_name: string; trade_name?: string; tax_id?: string;
    admin_email: string; admin_full_name: string;
  }, platformAdminId: string) {
    const legalName = input.legal_name?.trim();
    const adminEmail = input.admin_email?.trim().toLowerCase();
    const adminFullName = input.admin_full_name?.trim();
    if (!legalName || !adminEmail || !adminFullName) {
      throw new BadRequestException('legal_name, admin_email and admin_full_name are required');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      throw new BadRequestException('admin_email is invalid');
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const temporaryPasswordHash = await argon2.hash(randomBytes(48).toString('base64url'), { type: argon2.argon2id });

    const tenant = await this.db.withProvisioning(async client => {
      const tenantResult = await client.query(
        `INSERT INTO tenants (legal_name, trade_name, tax_id, status)
         VALUES ($1, $2, $3, 'TRIAL') RETURNING id, legal_name, trade_name`,
        [legalName, input.trade_name?.trim() || null, input.tax_id?.trim() || null],
      );
      const tenantId = tenantResult.rows[0].id as string;
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);

      const roleResult = await client.query(
        `INSERT INTO roles (tenant_id, code, name)
         VALUES ($1, 'TENANT_ADMIN', 'Administrador de empresa') RETURNING id`,
        [tenantId],
      );
      const roleId = roleResult.rows[0].id as string;

      await client.query(
        `INSERT INTO branches (tenant_id, code, name, address)
         VALUES ($1, 'MATRIZ', 'Matriz', NULL)`,
        [tenantId],
      );

      const equipmentTypes = [
        ['EXT-PQS','Extintor de polvo químico seco'],
        ['EXT-CO2','Extintor de dióxido de carbono'],
        ['EXT-AGUA','Extintor de agua'],
        ['HIDRANTE','Hidrante'],
        ['DETECTOR-H','Detector de humo'],
        ['DETECTOR-T','Detector de temperatura'],
        ['ALARMA','Alarma contra incendios'],
        ['ROCIADOR','Rociador automático'],
        ['BOMBA','Bomba contra incendios'],
        ['SUPRESION','Sistema de supresión'],
      ];
      for (const [code, name] of equipmentTypes) {
        await client.query(
          'INSERT INTO equipment_types (tenant_id, code, name) VALUES ($1, $2, $3)',
          [tenantId, code, name],
        );
      }

      const userResult = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, status)
         VALUES ($1, $2, $3, $4, 'INVITED') RETURNING id`,
        [tenantId, adminEmail, temporaryPasswordHash, adminFullName],
      );
      const userId = userResult.rows[0].id as string;
      await client.query(
        'INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)',
        [tenantId, userId, roleId],
      );
      await client.query(
        `INSERT INTO user_invitations
          (tenant_id, email, full_name, role_id, token_hash, expires_at, created_by_platform_admin_id)
         VALUES ($1, $2, $3, $4, $5, now() + interval '48 hours', $6)`,
        [tenantId, adminEmail, adminFullName, roleId, tokenHash, platformAdminId],
      );
      return tenantResult.rows[0];
    });

    const baseUrl = (process.env.WEB_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    return {
      tenant,
      administrator: { email: adminEmail, status: 'INVITED', role: 'TENANT_ADMIN' },
      invitation: {
        token: rawToken,
        acceptance_endpoint: 'POST /api/v1/invitations/accept',
        expires_in_hours: 48,
        delivery: 'MANUAL_ONE_TIME_TOKEN',
        warning: 'El token se muestra una sola vez. Compártelo por un canal seguro; la pantalla web y el envío automático de correo están pendientes.',
      },
    };
  }
}

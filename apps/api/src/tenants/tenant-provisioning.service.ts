import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database/database.service';
import { encryptOutboxPayload } from '../notifications/outbox-crypto';

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
    if (!legalName || !adminEmail || !adminFullName) throw new BadRequestException('legal_name, admin_email and admin_full_name are required');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new BadRequestException('admin_email is invalid');

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const temporaryPasswordHash = await argon2.hash(randomBytes(48).toString('base64url'), { type: argon2.argon2id });
    const webUrl = (process.env.WEB_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const acceptanceUrl = `${webUrl}/accept-invitation?token=${encodeURIComponent(rawToken)}`;
    const emailPayload = encryptOutboxPayload({
      subject: `Invitación a FireControl 360 — ${legalName}`,
      text: `Hola ${adminFullName},\n\nHas sido invitado a administrar ${legalName} en FireControl 360.\nAcepta tu invitación en: ${acceptanceUrl}\n\nEl enlace vence en 48 horas y solo puede utilizarse una vez.\n\nFireControl 360`,
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#18212f"><h1 style="color:#b42318">FireControl 360</h1><h2>Activa tu cuenta</h2><p>Hola ${adminFullName.replace(/[&<>"]/g, '')},</p><p>Has sido invitado a administrar <strong>${legalName.replace(/[&<>"]/g, '')}</strong>.</p><p><a href="${acceptanceUrl}" style="display:inline-block;background:#b42318;color:#fff;padding:14px 20px;text-decoration:none;border-radius:6px">Aceptar invitación</a></p><p>El enlace vence en 48 horas y solo puede utilizarse una vez.</p></div>`,
    });

    const tenant = await this.db.withProvisioning(async client => {
      const tenantResult = await client.query(
        `INSERT INTO tenants (legal_name, trade_name, tax_id, status)
         VALUES ($1, $2, $3, 'TRIAL') RETURNING id, legal_name, trade_name`,
        [legalName, input.trade_name?.trim() || null, input.tax_id?.trim() || null],
      );
      const tenantId = tenantResult.rows[0].id as string;
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const roleResult = await client.query(
        `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'TENANT_ADMIN', 'Administrador de empresa') RETURNING id`,
        [tenantId],
      );
      const roleId = roleResult.rows[0].id as string;
      await client.query("INSERT INTO branches (tenant_id, code, name, address) VALUES ($1, 'MATRIZ', 'Matriz', NULL)", [tenantId]);
      const equipmentTypes = [
        ['EXT-PQS','Extintor de polvo químico seco'],['EXT-CO2','Extintor de dióxido de carbono'],
        ['EXT-AGUA','Extintor de agua'],['HIDRANTE','Hidrante'],['DETECTOR-H','Detector de humo'],
        ['DETECTOR-T','Detector de temperatura'],['ALARMA','Alarma contra incendios'],
        ['ROCIADOR','Rociador automático'],['BOMBA','Bomba contra incendios'],['SUPRESION','Sistema de supresión'],
      ];
      for (const [code, name] of equipmentTypes) {
        await client.query('INSERT INTO equipment_types (tenant_id, code, name) VALUES ($1, $2, $3)', [tenantId, code, name]);
      }
      const userResult = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, status)
         VALUES ($1, $2, $3, $4, 'INVITED') RETURNING id`,
        [tenantId, adminEmail, temporaryPasswordHash, adminFullName],
      );
      const userId = userResult.rows[0].id as string;
      await client.query(
        `INSERT INTO audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data)
         VALUES ($1, NULL, 'TENANT_PROVISIONED', 'TENANT', $1, $2::jsonb)`,
        [tenantId, JSON.stringify({ legal_name: legalName, administrator_email: adminEmail })],
      );
      await client.query('INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [tenantId, userId, roleId]);
      await client.query(
        `INSERT INTO user_invitations
          (tenant_id, email, role_id, token_hash, status, expires_at, created_by_platform_admin_id)
         VALUES ($1, $2, $3, $4, 'PENDING', now() + interval '48 hours', $5)`,
        [tenantId, adminEmail, roleId, tokenHash, platformAdminId],
      );
      await client.query(
        `INSERT INTO notification_outbox
          (tenant_id, notification_type, recipient_email, payload_ciphertext, encryption_key_version,
           idempotency_key, status, available_at)
         VALUES ($1, 'TENANT_INVITATION', $2, $3, 'v1', $4, 'PENDING', now())`,
        [tenantId, adminEmail, emailPayload, `tenant-invitation:${tenantId}:${adminEmail}`],
      );
      return tenantResult.rows[0];
    });

    return {
      tenant,
      administrator: { email: adminEmail, full_name: adminFullName, status: 'INVITED', role: 'TENANT_ADMIN' },
      invitation: { delivery: 'QUEUED', expires_in_hours: 48, acceptance_url: acceptanceUrl, warning: 'El correo quedó en cola; su entrega depende de la configuración SMTP y del worker de notificaciones.' },
    };
  }
}

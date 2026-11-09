import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AuthService {
  constructor(private readonly db: DatabaseService, private readonly jwt: JwtService) {}

  async tenantLogin(input: { tenant_id: string; email: string; password: string }) {
    if (!input.tenant_id || !input.email || !input.password) throw new BadRequestException('tenant_id, email and password are required');
    return this.db.withTenant(input.tenant_id, async client => {
      const result = await client.query(
        `SELECT u.id, u.tenant_id, u.email, u.password_hash
         FROM users u WHERE u.email = $1 AND u.status = 'ACTIVE' LIMIT 1`,
        [input.email.trim().toLowerCase()],
      );
      const user = result.rows[0];
      if (!user || !(await argon2.verify(user.password_hash, input.password))) {
        throw new UnauthorizedException('Invalid credentials');
      }
      const roleResult = await client.query(
        `SELECT r.code FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
         WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
        [input.tenant_id, user.id],
      );
      const roles = roleResult.rows.map(row => row.code as string);
      const access_token = await this.jwt.signAsync({
        sub: user.id, tenantId: user.tenant_id, roles, kind: 'tenant',
      });
      return { access_token, token_type: 'Bearer', expires_in: process.env.JWT_EXPIRES_IN ?? '15m' };
    });
  }

  async platformLogin(input: { email: string; password: string }) {
    if (!input.email || !input.password) throw new BadRequestException('email and password are required');
    const result = await this.db.platformQuery(
      "SELECT id, password_hash FROM platform_admins WHERE email = $1 AND status = 'ACTIVE' LIMIT 1",
      [input.email.trim().toLowerCase()],
    );
    const admin = result.rows[0];
    if (!admin || !(await argon2.verify(admin.password_hash, input.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    await this.db.platformQuery('UPDATE platform_admins SET last_login_at = now() WHERE id = $1', [admin.id]);
    const access_token = await this.jwt.signAsync({ sub: admin.id, kind: 'platform' });
    return { access_token, token_type: 'Bearer', expires_in: process.env.JWT_EXPIRES_IN ?? '15m' };
  }

  async acceptInvitation(input: { token: string; password: string }) {
    if (!input.token || !input.password || input.password.length < 12) {
      throw new BadRequestException('A valid invitation token and password of at least 12 characters are required');
    }
    const tokenHash = createHash('sha256').update(input.token).digest('hex');
    const invite = await this.db.platformQuery(
      `SELECT id, tenant_id, email FROM user_invitations
       WHERE token_hash = $1 AND status = 'PENDING' AND expires_at > now()
       LIMIT 1`,
      [tokenHash],
    );
    if (invite.rowCount !== 1) throw new BadRequestException('Invitation is invalid, expired or already used');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    return this.db.withProvisioning(async client => {
      const locked = await client.query(
        `SELECT id, tenant_id, email FROM user_invitations
         WHERE id = $1 AND status = 'PENDING' AND expires_at > now()
         FOR UPDATE`,
        [invite.rows[0].id],
      );
      if (locked.rowCount !== 1) throw new BadRequestException('Invitation is no longer valid');
      const row = locked.rows[0];
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [row.tenant_id]);
      const userResult = await client.query(
        `UPDATE users SET password_hash = $1, status = 'ACTIVE', updated_at = now()
         WHERE tenant_id = $2 AND email = $3 AND status = 'INVITED'
         RETURNING id, tenant_id`,
        [passwordHash, row.tenant_id, row.email],
      );
      if (userResult.rowCount !== 1) throw new BadRequestException('Invited user was not found or is no longer eligible');
      await client.query(
        `UPDATE user_invitations
         SET status = 'ACCEPTED', accepted_at = now(), accepted_by_user_id = $1
         WHERE id = $2`,
        [userResult.rows[0].id, row.id],
      );
      const user = userResult.rows[0];
      const roleResult = await client.query(
        `SELECT r.code FROM user_roles ur JOIN roles r
         ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
         WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
        [user.tenant_id, user.id],
      );
      const roles = roleResult.rows.map(item => item.code as string);
      const access_token = await this.jwt.signAsync({
        sub: user.id, tenantId: user.tenant_id, roles, kind: 'tenant',
      });
      return { access_token, token_type: 'Bearer', tenant_id: user.tenant_id };
    });
  }
}

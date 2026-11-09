import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { AuthenticatedUser } from './auth.types';

@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Bearer token required');
    try {
      const claims = await this.jwt.verifyAsync<AuthenticatedUser>(header.slice(7));
      if (claims.kind !== 'tenant' || !claims.sub || !claims.tenantId) throw new Error('Invalid tenant claims');
      const active = await this.db.withTenant(claims.tenantId, async client => {
        const result = await client.query(
          "SELECT id FROM users WHERE id = $1 AND status = 'ACTIVE' LIMIT 1",
          [claims.sub],
        );
        return result.rowCount === 1;
      });
      if (!active) throw new Error('User is not active');
      request.user = claims;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}

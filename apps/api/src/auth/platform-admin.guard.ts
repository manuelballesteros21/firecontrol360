import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = request.headers.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Platform bearer token required');
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; kind: string }>(header.slice(7));
      if (claims.kind !== 'platform' || !claims.sub) throw new Error('Invalid platform claims');
      const result = await this.db.platformQuery(
        "SELECT id FROM platform_admins WHERE id = $1 AND status = 'ACTIVE' LIMIT 1",
        [claims.sub],
      );
      if (result.rowCount !== 1) throw new Error('Platform administrator disabled');
      request.platformAdmin = { id: claims.sub };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired platform session');
    }
  }
}

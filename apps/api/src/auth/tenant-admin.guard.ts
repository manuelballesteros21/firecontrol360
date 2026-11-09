import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class TenantAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (!request.user?.roles?.includes('TENANT_ADMIN')) {
      throw new ForbiddenException('TENANT_ADMIN role is required');
    }
    return true;
  }
}

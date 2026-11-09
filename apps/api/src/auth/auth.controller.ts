import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TenantAuthGuard } from './tenant-auth.guard';
import { AuthenticatedUser } from './auth.types';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('auth/login')
  tenantLogin(@Body() body: { tenant_id: string; email: string; password: string }) {
    return this.auth.tenantLogin(body);
  }

  @Get('auth/me')
  @UseGuards(TenantAuthGuard)
  me(@Req() request: { user: AuthenticatedUser }) {
    return { user_id: request.user.sub, tenant_id: request.user.tenantId, roles: request.user.roles };
  }

  @Post('platform/auth/login')
  platformLogin(@Body() body: { email: string; password: string }) {
    return this.auth.platformLogin(body);
  }

  @Post('invitations/accept')
  acceptInvitation(@Body() body: { token: string; password: string }) {
    return this.auth.acceptInvitation(body);
  }
}
